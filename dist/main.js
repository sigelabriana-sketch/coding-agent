// src/main.ts
import * as readline from "readline";

// src/config.ts
var API_CONFIG = {
  baseUrl: process.env.ANTHROPIC_BASE_URL || "http://localhost:8080",
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN || "sk-test",
  model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241027",
  maxTokens: 8192,
  temperature: 0,
  allowedCommands: ["git", "npm", "node", "bun", "ls", "cat", "grep", "find", "echo", "pwd"],
  maxConcurrentWorkers: 4,
  workerIdleTimeoutMs: 300000,
  maxTokensPerRequest: 8192,
  requestTimeoutMs: 60000
};

// src/llm.ts
class LLMClient {
  baseUrl;
  apiKey;
  model;
  constructor() {
    this.baseUrl = API_CONFIG.baseUrl;
    this.apiKey = API_CONFIG.apiKey;
    this.model = API_CONFIG.model;
  }
  async call(options) {
    const {
      messages,
      systemPrompt,
      maxTokens = API_CONFIG.maxTokens,
      temperature = API_CONFIG.temperature,
      tools
    } = options;
    const body = {
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages,
      thinking: { type: "disabled" }
    };
    if (systemPrompt) {
      body.messages = [
        { role: "system", content: systemPrompt },
        ...messages
      ];
    } else {
      body.messages = messages;
    }
    if (tools && tools.length > 0) {
      body.tools = tools;
    }
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    const content = [];
    const toolCalls = [];
    if (data.content) {
      for (const block of data.content) {
        if (block.type === "text") {
          const text = block.text || "";
          content.push(text.trim());
        } else if (block.type === "tool_use") {
          toolCalls.push({
            name: block.name || "",
            input: block.input || {}
          });
        }
      }
    }
    return {
      content: content.join(`
`),
      stopReason: data.stop_reason || "unknown",
      usage: data.usage ? {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens
      } : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    };
  }
}

// src/coordinator/TaskStateMachine.ts
class TaskStateMachine {
  tasks = new Map;
  add(task) {
    task.status = "pending";
    task.createdAt = Date.now();
    task.updatedAt = Date.now();
    this.tasks.set(task.id, task);
  }
  get(id) {
    return this.tasks.get(id);
  }
  getAll() {
    return Array.from(this.tasks.values());
  }
  start(id) {
    const task = this.tasks.get(id);
    if (!task || task.status !== "pending")
      return false;
    task.status = "running";
    task.updatedAt = Date.now();
    return true;
  }
  complete(id, result) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = "completed";
      task.result = result;
      task.updatedAt = Date.now();
    }
  }
  fail(id, error) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = "failed";
      task.result = error;
      task.updatedAt = Date.now();
    }
  }
  kill(id) {
    const task = this.tasks.get(id);
    if (task && !this.isTerminal(task.status)) {
      task.status = "killed";
      task.updatedAt = Date.now();
    }
  }
  isTerminal(status) {
    return status === "completed" || status === "failed" || status === "killed";
  }
  canStart(id) {
    const task = this.tasks.get(id);
    if (!task || task.status !== "pending")
      return false;
    if (task.dependsOn) {
      for (const depId of task.dependsOn) {
        const dep = this.tasks.get(depId);
        if (!dep || !this.isTerminal(dep.status))
          return false;
      }
    }
    return true;
  }
  getRunnableTasks() {
    return this.getAll().filter((t) => this.canStart(t.id));
  }
  getPendingTasks() {
    return this.getAll().filter((t) => t.status === "pending");
  }
  isAllDone() {
    return this.getAll().every((t) => this.isTerminal(t.status));
  }
}

// src/tools/bash.ts
import { spawn } from "child_process";
var BashTool = {
  name: "BashTool",
  description: "Execute shell commands. Use for git, npm, file operations, etc.",
  definition: {
    name: "BashTool",
    description: "Execute shell commands",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        workingDir: { type: "string", description: "Optional working directory" },
        timeout: { type: "number", description: "Timeout in milliseconds (default: 30000)" }
      },
      required: ["command"]
    }
  },
  async execute(input) {
    const command = input.command;
    if (!command)
      return { success: false, output: "", error: "command is required" };
    const dangerous = ["rm -rf /", "dd if=", ":(){", "> /dev/sda"];
    for (const pattern of dangerous) {
      if (command.includes(pattern)) {
        return { success: false, output: "", error: `Command blocked: ${pattern}` };
      }
    }
    const firstWord = command.trim().split(/\s+/)[0];
    if (!API_CONFIG.allowedCommands.includes(firstWord)) {
      return { success: false, output: "", error: `Command not allowed: ${firstWord}` };
    }
    const timeout = input.timeout || 30000;
    const workingDir = input.workingDir;
    return new Promise((resolve) => {
      const startTime = Date.now();
      const opts = { shell: true, timeout, killSignal: "SIGTERM" };
      if (workingDir)
        opts.cwd = workingDir;
      const child = spawn(command, [], opts);
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });
      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({ success: false, output: stdout, error: `Timeout after ${timeout}ms` });
      }, timeout);
      child.on("close", (code) => {
        clearTimeout(timer);
        const duration = Date.now() - startTime;
        if (code === 0) {
          resolve({ success: true, output: stdout || `Done in ${duration}ms` });
        } else {
          resolve({ success: false, output: stdout, error: stderr || `Exit code: ${code}` });
        }
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ success: false, output: "", error: String(err) });
      });
    });
  }
};

// src/tools/file_read.ts
import { readFileSync, statSync } from "fs";
var FileReadTool = {
  name: "FileReadTool",
  description: "Read the contents of a file",
  definition: {
    name: "FileReadTool",
    description: "Read file contents",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
        offset: { type: "number", description: "Line offset to start reading from (0-indexed)" },
        limit: { type: "number", description: "Maximum number of lines to read" }
      },
      required: ["path"]
    }
  },
  async execute(input) {
    const path = input.path;
    if (!path)
      return { success: false, output: "", error: "path is required" };
    try {
      const stat = statSync(path);
      if (!stat.isFile())
        return { success: false, output: "", error: "Not a file" };
      const offset = input.offset || 0;
      const limit = input.limit || Infinity;
      const content = readFileSync(path, "utf-8");
      const lines = content.split(`
`);
      const selected = lines.slice(offset, offset + limit);
      return {
        success: true,
        output: `File: ${path}
Lines: ${offset + 1}-${offset + selected.length}/${lines.length}

${selected.join(`
`)}`
      };
    } catch (e) {
      return { success: false, output: "", error: String(e) };
    }
  }
};

// src/tools/file_edit.ts
import { readFileSync as readFileSync2, writeFileSync } from "fs";
var FileEditTool = {
  name: "FileEditTool",
  description: "Edit a file by replacing specific text or inserting at positions",
  definition: {
    name: "FileEditTool",
    description: "Edit file contents in place",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
        oldText: { type: "string", description: "Exact text to find and replace" },
        newText: { type: "string", description: "Replacement text" },
        insertAfter: { type: "string", description: "Insert after this text" },
        insertBefore: { type: "string", description: "Insert before this text" }
      },
      required: ["path"]
    }
  },
  async execute(input) {
    const path = input.path;
    if (!path)
      return { success: false, output: "", error: "path is required" };
    try {
      const content = readFileSync2(path, "utf-8");
      const oldText = input.oldText;
      const newText = input.newText;
      let newContent;
      if (oldText && newText) {
        if (!content.includes(oldText)) {
          return { success: false, output: "", error: `oldText not found in file` };
        }
        newContent = content.replace(oldText, newText);
      } else if (input.insertAfter) {
        if (!content.includes(input.insertAfter)) {
          return { success: false, output: "", error: "insertAfter text not found" };
        }
        newContent = content.replace(input.insertAfter, input.insertAfter + newText);
      } else if (input.insertBefore) {
        if (!content.includes(input.insertBefore)) {
          return { success: false, output: "", error: "insertBefore text not found" };
        }
        newContent = content.replace(input.insertBefore, newText + input.insertBefore);
      } else {
        return { success: false, output: "", error: "Must provide oldText+newText or insertAfter or insertBefore" };
      }
      writeFileSync(path, newContent, "utf-8");
      return { success: true, output: `Edited: ${path}` };
    } catch (e) {
      return { success: false, output: "", error: String(e) };
    }
  }
};

// src/tools/file_write.ts
import { writeFileSync as writeFileSync2, mkdirSync } from "fs";
import { dirname } from "path";
var FileWriteTool = {
  name: "FileWriteTool",
  description: "Create a new file or overwrite an existing file",
  definition: {
    name: "FileWriteTool",
    description: "Write or create a file",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
        content: { type: "string", description: "File content to write" }
      },
      required: ["path", "content"]
    }
  },
  async execute(input) {
    const path = input.path;
    const content = input.content;
    if (!path || content === undefined) {
      return { success: false, output: "", error: "path and content are required" };
    }
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync2(path, content, "utf-8");
      return { success: true, output: `Written: ${path}` };
    } catch (e) {
      return { success: false, output: "", error: String(e) };
    }
  }
};

// src/tools/index.ts
class ToolRegistry {
  tools = new Map;
  register(tool) {
    this.tools.set(tool.name, tool);
  }
  get(name) {
    return this.tools.get(name);
  }
  getAll() {
    return Array.from(this.tools.values());
  }
  getDefinitions() {
    return this.getAll().map((t) => t.definition);
  }
  async execute(name, input) {
    const tool = this.get(name);
    if (!tool)
      return { success: false, output: "", error: `Unknown tool: ${name}` };
    try {
      return await tool.execute(input);
    } catch (e) {
      return { success: false, output: "", error: String(e) };
    }
  }
}
var toolRegistry = new ToolRegistry;
toolRegistry.register(BashTool);
toolRegistry.register(FileReadTool);
toolRegistry.register(FileEditTool);
toolRegistry.register(FileWriteTool);

// src/coordinator/WorkerManager.ts
class WorkerManager {
  llm;
  activeWorkers = new Map;
  constructor() {
    this.llm = new LLMClient;
  }
  buildWorkerPrompt(task, systemContext) {
    const taskInstructions = {
      research: `You are in RESEARCH mode. Investigate the codebase.
- Use BashTool to run git log, find, grep as needed.
- Use FileReadTool to examine files.`,
      implement: `You are in IMPLEMENT mode. Write code.
- Use FileWriteTool to create new files.
- Use FileEditTool to modify existing files.`,
      verify: `You are in VERIFY mode. Test the implementation.`,
      test: `You are in TEST mode. Run the test suite.`,
      review: `You are in REVIEW mode. Review code quality.`
    };
    return `${systemContext}

## Task
Type: ${task.type}
Description: ${task.description}

${taskInstructions[task.type] || taskInstructions.implement}

## Details
${task.prompt}

## Output
When done, respond with this EXACT XML format (include your task-id=${task.id}):
<task-notification>
<task-id>${task.id}</task-id>
<status>completed</status>
<summary>One line summary of what you did</summary>
<result>Details of what you accomplished</result>
</task-notification>`;
  }
  async spawnWorker(task, systemContext) {
    console.log(`[WorkerManager] Spawning worker: ${task.id} (${task.type})`);
    const tools = toolRegistry.getDefinitions();
    try {
      const r1 = await this.llm.call({
        messages: [{ role: "user", content: this.buildWorkerPrompt(task, systemContext) }],
        tools,
        maxTokens: API_CONFIG.maxTokensPerRequest
      });
      if (!r1.toolCalls?.length) {
        return this.parseNotification(task.id, r1.content);
      }
      const toolResults = [];
      for (const tc of r1.toolCalls) {
        const result = await toolRegistry.execute(tc.name, tc.input);
        toolResults.push({ name: tc.name, ...result });
        console.log(`[WorkerManager] Tool ${tc.name}: ${result.success ? "OK" : "FAIL"}`);
      }
      const allSuccess = toolResults.every((r) => r.success);
      if (allSuccess) {
        const resultsSummary = toolResults.map((r) => `${r.name}: ${r.output}`).join(`
`);
        return {
          taskId: task.id,
          status: "completed",
          summary: `Executed ${toolResults.length} tool(s) successfully`,
          result: resultsSummary
        };
      } else {
        const failureMsg = toolResults.map((r) => `${r.name}: ${r.error || r.output}`).join(`
`);
        const r2 = await this.llm.call({
          messages: [{
            role: "user",
            content: `Some tools failed:
${failureMsg}

Fix the errors or report the failure with XML:
<task-notification>
<task-id>${task.id}</task-id>
<status>failed</status>
<summary>Error summary</summary>
<result>Error details</result>
</task-notification>`
          }],
          tools,
          maxTokens: 500
        });
        return this.parseNotification(task.id, r2.content);
      }
    } catch (e) {
      return { taskId: task.id, status: "failed", summary: String(e), result: String(e) };
    }
  }
  stopWorker(taskId) {
    const w = this.activeWorkers.get(taskId);
    if (w) {
      w.abort.abort();
      this.activeWorkers.delete(taskId);
    }
  }
  parseNotification(taskId, content) {
    const s = content.match(/<status>([^<]+)<\/status>/)?.[1];
    return {
      taskId,
      status: s || "completed",
      summary: content.match(/<summary>([^<]+)<\/summary>/)?.[1] || "No summary",
      result: content.match(/<result>([\s\S]+?)<\/result>/)?.[1] || content.slice(0, 300)
    };
  }
  getActiveCount() {
    return this.activeWorkers.size;
  }
}

// src/context.ts
import { execSync } from "child_process";
import { readFileSync as readFileSync3, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
function findClaudeMdFiles(startDir) {
  const files = [];
  let dir = resolve(startDir);
  for (let i = 0;i < 5; i++) {
    const mdPath = join(dir, "CLAUDE.md");
    if (existsSync(mdPath)) {
      try {
        files.push({ path: mdPath, content: readFileSync3(mdPath, "utf-8") });
      } catch {}
    }
    const parent = join(dir, "..");
    if (parent === dir)
      break;
    dir = parent;
  }
  return files;
}
function scanMemoryDir(memoryDir) {
  const files = [];
  if (!existsSync(memoryDir))
    return files;
  try {
    for (const entry of readdirSync(memoryDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "MEMORY.md") {
        const filePath = join(memoryDir, entry.name);
        try {
          const content = readFileSync3(filePath, "utf-8");
          files.push({ path: filePath, name: entry.name.replace(".md", ""), type: "reference", content });
        } catch {}
      }
    }
  } catch {}
  return files;
}
function getGitStatus(cwd) {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
    return [
      `Branch: ${execSync("git branch --show-current", { cwd, encoding: "utf-8" }).trim()}`,
      `Status: ${execSync("git status --short", { cwd, encoding: "utf-8" }).trim() || "(clean)"}`,
      `Recent commits:
${execSync("git log --oneline -n 5", { cwd, encoding: "utf-8" }).trim()}`
    ].join(`
`);
  } catch {
    return null;
  }
}
async function collectContext(projectRoot) {
  const gitStatus = getGitStatus(projectRoot);
  const claudeMdFiles = findClaudeMdFiles(projectRoot);
  const memoryDir = join(projectRoot, ".claude", "memory");
  const memoryFiles = scanMemoryDir(memoryDir);
  return {
    gitStatus,
    memoryFiles,
    claudeMdFiles,
    currentDate: new Date().toISOString().split("T")[0],
    projectRoot
  };
}
function buildWorkerSystemPrompt(ctx) {
  const lines = [`# Worker Context`, ``, `Date: ${ctx.currentDate}`, ``];
  if (ctx.gitStatus)
    lines.push(`## Git
\`\`\`
${ctx.gitStatus}
\`\`\`
`);
  for (const f of ctx.claudeMdFiles)
    lines.push(`## ${f.path}
${f.content}
`);
  if (ctx.memoryFiles.length) {
    lines.push(`## Memory`);
    for (const m of ctx.memoryFiles)
      lines.push(`
### ${m.name} [${m.type}]
${m.content.slice(0, 300)}
`);
  }
  lines.push(`## Tools`, `Available: BashTool, FileReadTool, FileEditTool, FileWriteTool`, ``);
  return lines.join(`
`);
}

// src/coordinator/Coordinator.ts
class Coordinator {
  llm;
  taskManager;
  workerManager;
  context = "";
  projectRoot;
  constructor(projectRoot) {
    this.llm = new LLMClient;
    this.taskManager = new TaskStateMachine;
    this.workerManager = new WorkerManager;
    this.projectRoot = projectRoot;
  }
  async init() {
    const ctx = await collectContext(this.projectRoot);
    this.context = buildWorkerSystemPrompt(ctx);
    console.log("[Coordinator] Initialized");
  }
  async handleUserTask(userPrompt) {
    console.log(`
[Coordinator] New task:`, userPrompt.slice(0, 80));
    const plan = await this.plan(userPrompt);
    console.log(`[Coordinator] Planned ${plan.tasks.length} task(s)`);
    const results = await this.execute(plan.tasks);
    return this.synthesize(userPrompt, results);
  }
  async plan(userPrompt) {
    const systemPrompt = `You are a task planner for a coding agent.
Given the user's request, break it down into tasks for workers.
Each task should be one of: research, implement, verify, test, review

Rules:
- research tasks explore and understand (can run in parallel)
- implement tasks write code (run sequentially per file)
- verify tasks check correctness (can run after implement)
- Output valid JSON with a "tasks" array`;
    try {
      const response = await this.llm.call({
        messages: [
          { role: "user", content: `You are a task planner. Output valid JSON with a "tasks" array. Each task has: type, description, prompt, dependsOn. User request: ${userPrompt}` }
        ],
        maxTokens: 2048
      });
      const cleaned = response.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(cleaned);
    } catch (e) {
      console.error("[Coordinator] Plan parse failed, using fallback:", e);
      return { tasks: [{ type: "implement", description: "Execute task", prompt: userPrompt }] };
    }
  }
  async execute(taskDefs) {
    const results = new Map;
    for (const def of taskDefs) {
      const task = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: def.type,
        description: def.description,
        prompt: def.prompt,
        status: "pending",
        dependsOn: def.dependsOn,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.taskManager.add(task);
      if (def.dependsOn?.length) {
        console.log(`[Coordinator] Task ${task.id} waiting for dependencies...`);
        while (!this.taskManager.canStart(task.id)) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      this.taskManager.start(task.id);
      console.log(`[Coordinator] Running task: ${task.description}`);
      const result = await this.workerManager.spawnWorker(task, this.context);
      results.set(task.id, result);
      if (result.status === "completed") {
        this.taskManager.complete(task.id, result.result);
      } else {
        this.taskManager.fail(task.id, result.result);
      }
      this.context += `

[TASK ${task.id} RESULT]: ${result.summary}
${result.result.slice(0, 200)}`;
    }
    return results;
  }
  synthesize(userPrompt, results) {
    const lines = [`## 任务完成
`];
    for (const [taskId, result] of results) {
      const icon = result.status === "completed" ? "✅" : "❌";
      lines.push(`${icon} **${taskId}** (${result.status})`);
      lines.push(`   ${result.summary}`);
      if (result.status === "failed") {
        lines.push(`   Error: ${result.result.slice(0, 200)}`);
      }
      lines.push("");
    }
    return lines.join(`
`);
  }
}

// src/main.ts
async function main() {
  const projectRoot = process.argv[2] || process.cwd();
  console.log("╔══════════════════════════════════════╗");
  console.log("║   Local Coding Agent (MiniMax M2.7)  ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(`Project: ${projectRoot}`);
  console.log(`Model: MiniMax M2.7 via local proxy`);
  console.log("");
  const coordinator = new Coordinator(projectRoot);
  await coordinator.init();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`Ready. Type your task (Ctrl+C to exit):
`);
  while (true) {
    const input = await new Promise((resolve2) => rl.question("> ", resolve2));
    if (!input.trim())
      continue;
    try {
      const response = await coordinator.handleUserTask(input);
      console.log(`
` + response + `
`);
    } catch (e) {
      console.error("Error:", e);
    }
  }
}
main().catch(console.error);
