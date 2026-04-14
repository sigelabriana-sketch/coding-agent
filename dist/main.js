import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/main.ts
import * as readline from "readline";

// src/config.ts
var API_CONFIG = {
  baseUrl: process.env.ANTHROPIC_BASE_URL || "http://localhost:8080",
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN || "sk-test",
  model: process.env.ANTHROPIC_MODEL || "astron-code-latest",
  maxTokens: 8192,
  temperature: 0,
  allowedCommands: [
    "git",
    "npm",
    "node",
    "bun",
    "ls",
    "cat",
    "grep",
    "find",
    "echo",
    "pwd",
    "mkdir",
    "touch",
    "cp",
    "mv",
    "rm",
    "chmod",
    "chown",
    "wc",
    "head",
    "tail",
    "sort",
    "uniq",
    "cut",
    "tr",
    "cd",
    "pwd",
    "test"
  ],
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
      max_tokens: Math.max(1, maxTokens),
      temperature
    };
    if (systemPrompt) {
      body.system = systemPrompt;
      body.messages = messages;
    } else {
      body.messages = messages;
    }
    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema
      }));
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
    const textParts = [];
    const toolCalls = [];
    if (data.content) {
      for (const block of data.content) {
        if (block.type === "text") {
          textParts.push(block.text || "");
        } else if (block.type === "tool_use") {
          toolCalls.push({
            name: block.name || "",
            input: block.input || {}
          });
        }
      }
    }
    return {
      content: textParts.join(""),
      stopReason: data.stop_reason || "end_turn",
      usage: data.usage ? {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: data.usage.total_tokens
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
  getAllTasks() {
    return this.getAll();
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
import { readFileSync, statSync, existsSync } from "fs";
import { resolve, isAbsolute } from "path";
var FileReadTool = {
  name: "FileReadTool",
  description: "Read the contents of a file",
  definition: {
    name: "FileReadTool",
    description: "Read file contents",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
        offset: { type: "number", description: "Line offset (0-indexed)" },
        limit: { type: "number", description: "Max lines to read" }
      },
      required: ["path"]
    }
  },
  async execute(input) {
    let path = input.path;
    if (!path)
      return { success: false, output: "", error: "path is required" };
    if (!isAbsolute(path)) {
      path = resolve(process.cwd(), path);
    }
    if (!existsSync(path)) {
      return { success: false, output: "", error: `File not found: ${path}` };
    }
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
import { dirname, resolve as resolve2, isAbsolute as isAbsolute2 } from "path";
var FileWriteTool = {
  name: "FileWriteTool",
  description: "Create a new file or overwrite an existing file",
  definition: {
    name: "FileWriteTool",
    description: "Write or create a file",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
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
      const absPath = isAbsolute2(path) ? path : resolve2(process.cwd(), path);
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync2(absPath, content, "utf-8");
      return { success: true, output: `Written: ${absPath}` };
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

// src/storage/FileLockManager.ts
class FileLockManager {
  locks = new Map;
  requestLock(files, taskId) {
    for (const file of files) {
      const existing = this.locks.get(file);
      if (existing && existing.taskId !== taskId) {
        return { granted: false, blockedBy: `${file} (locked by ${existing.taskId})` };
      }
    }
    for (const file of files) {
      this.locks.set(file, { taskId, acquiredAt: Date.now() });
    }
    return { granted: true };
  }
  releaseLock(taskId) {
    const released = [];
    for (const [file, lock] of this.locks.entries()) {
      if (lock.taskId === taskId) {
        this.locks.delete(file);
        released.push(file);
      }
    }
    return released;
  }
  hasLock(taskId, file) {
    return this.locks.get(file)?.taskId === taskId;
  }
  getStatus() {
    const status = {};
    for (const [file, lock] of this.locks.entries()) {
      status[file] = lock.taskId;
    }
    return status;
  }
}

// src/coordinator/WorkerPool.ts
class WorkerPool {
  llm;
  lockManager;
  running = new Map;
  constructor() {
    this.llm = new LLMClient;
    this.lockManager = new FileLockManager;
  }
  async runWorker(task, systemContext) {
    if (this.running.has(task.id)) {
      return this.running.get(task.id).promise;
    }
    const abort = new AbortController;
    const filesInTask = task.prompt ? this.extractFilesFromPrompt(task.prompt) : [];
    const isWriteTask = task.type === "implement" || task.type === "verify";
    if (isWriteTask && filesInTask.length > 0) {
      const lockResult = this.lockManager.requestLock(filesInTask, task.id);
      if (!lockResult.granted) {
        return {
          taskId: task.id,
          status: "failed",
          summary: "Blocked by file lock",
          result: `Cannot acquire locks: ${lockResult.blockedBy}`
        };
      }
    }
    console.log(`[WorkerPool] Starting worker: ${task.id} (${task.type}) ${isWriteTask ? "[writing]" : "[reading]"}`);
    const promise = this.executeWorker(task, systemContext);
    this.running.set(task.id, { task, abort, promise });
    try {
      const result = await promise;
      if (isWriteTask && filesInTask.length > 0) {
        const released = this.lockManager.releaseLock(task.id);
        if (released.length > 0)
          console.log(`[WorkerPool] Released locks: ${released.join(", ")}`);
      }
      return result;
    } finally {
      this.running.delete(task.id);
    }
  }
  stopWorker(taskId) {
    const worker = this.running.get(taskId);
    if (worker) {
      worker.abort.abort();
      this.running.delete(taskId);
      this.lockManager.releaseLock(taskId);
      console.log(`[WorkerPool] Stopped worker: ${taskId}`);
    }
  }
  stopAll() {
    for (const [taskId] of this.running) {
      this.stopWorker(taskId);
    }
  }
  getRunningCount() {
    return this.running.size;
  }
  getLockStatus() {
    return this.lockManager.getStatus();
  }
  extractFilesFromPrompt(prompt) {
    const files = [];
    const patterns = [
      /src\/[\w/.-]+/g,
      /[\w-]+\.(ts|js|tsx|jsx|py|go|rs)/g,
      /\/[\w/.-]+\.(ts|js|tsx|jsx|py|go|rs)/g
    ];
    for (const pattern of patterns) {
      const matches = prompt.match(pattern);
      if (matches)
        files.push(...matches);
    }
    return [...new Set(files)];
  }
  async executeWorker(task, systemContext) {
    const tools = toolRegistry.getDefinitions();
    const modeInstructions = {
      research: `You are in RESEARCH mode.
- Use BashTool to explore: ls, find, grep, cat
- Use FileReadTool to read files
- Report specific findings with file paths and line numbers`,
      implement: `You are in IMPLEMENT mode.
- Use FileWriteTool to create new files
- Use FileEditTool to modify existing files
- After writing, verify the file content`,
      verify: `You are in VERIFY mode.
- Use BashTool to run tests, linters, type checkers
- Use FileReadTool to examine outputs
- Report pass/fail with specific evidence`,
      test: `You are in TEST mode.
- Run test suites with BashTool
- Report test results in detail`,
      review: `You are in REVIEW mode.
- Use BashTool and FileReadTool to analyze code
- Suggest specific improvements with examples`
    };
    const taskInstructions = `${systemContext}

## Task
Type: ${task.type}
Description: ${task.description}

${modeInstructions[task.type] || modeInstructions.implement}

## Details
${task.prompt}

## Task ID
task-id: ${task.id}

## Output
When done, respond with this EXACT XML (include your task-id=${task.id}):
<task-notification>
<task-id>${task.id}</task-id>
<status>completed</status>
<summary>One line summary</summary>
<result>Details of what you did</result>
</task-notification>`;
    const messages = [
      { role: "user", content: taskInstructions }
    ];
    const MAX_ITERATIONS = 10;
    try {
      for (let i = 0;i < MAX_ITERATIONS; i++) {
        const response = await this.llm.call({
          messages,
          tools,
          maxTokens: API_CONFIG.maxTokensPerRequest
        });
        const content = response.content.trim();
        if (!response.toolCalls?.length) {
          if (content.includes("<task-notification>")) {
            return this.parseNotification(task.id, content);
          }
          return {
            taskId: task.id,
            status: "failed",
            summary: "Model returned plain text without tools or XML",
            result: `Response: ${content.slice(0, 500)}`
          };
        }
        for (const tc of response.toolCalls) {
          const result = await toolRegistry.execute(tc.name, tc.input);
          const toolMsg = result.success ? `Tool ${tc.name} result: ${result.output}` : `Tool ${tc.name} failed: ${result.error}`;
          messages.push({ role: "user", content: toolMsg });
          console.log(`[WorkerPool] Tool ${tc.name}: ${result.success ? "OK" : "FAIL"}`);
        }
      }
      return {
        taskId: task.id,
        status: "failed",
        summary: `Max iterations (${MAX_ITERATIONS}) reached without XML notification`,
        result: "Worker loop exceeded maximum iterations"
      };
    } catch (e) {
      return { taskId: task.id, status: "failed", summary: String(e), result: String(e) };
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
}

// src/context.ts
import { execSync } from "child_process";
import { readFileSync as readFileSync3, existsSync as existsSync2, readdirSync } from "fs";
import { join, resolve as resolve3 } from "path";
function findClaudeMdFiles(startDir) {
  const files = [];
  let dir = resolve3(startDir);
  for (let i = 0;i < 5; i++) {
    const mdPath = join(dir, "CLAUDE.md");
    if (existsSync2(mdPath)) {
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
  if (!existsSync2(memoryDir))
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

// src/storage/SessionStore.ts
import { readFileSync as readFileSync4, writeFileSync as writeFileSync3, existsSync as existsSync3, mkdirSync as mkdirSync2 } from "fs";
import { join as join2 } from "path";

class SessionStore {
  sessionDir;
  constructor(sessionDir = join2(process.cwd(), ".coding-agent", "sessions")) {
    this.sessionDir = sessionDir;
    mkdirSync2(this.sessionDir, { recursive: true });
  }
  sessionPath(sessionId) {
    return join2(this.sessionDir, `${sessionId}.json`);
  }
  save(session) {
    session.updatedAt = Date.now();
    writeFileSync3(this.sessionPath(session.id), JSON.stringify(session, null, 2), "utf-8");
  }
  load(sessionId) {
    const path = this.sessionPath(sessionId);
    if (!existsSync3(path))
      return null;
    try {
      return JSON.parse(readFileSync4(path, "utf-8"));
    } catch {
      return null;
    }
  }
  list() {
    const { readdirSync: readdirSync2, statSync: statSync2 } = __require("fs");
    const sessions = [];
    try {
      for (const file of readdirSync2(this.sessionDir)) {
        if (!file.endsWith(".json"))
          continue;
        const s = this.load(file.replace(".json", ""));
        if (s)
          sessions.push(s);
      }
    } catch {}
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  delete(sessionId) {
    const { unlinkSync } = __require("fs");
    const path = this.sessionPath(sessionId);
    if (existsSync3(path))
      unlinkSync(path);
  }
}

// src/memory/MemoryPalace.ts
import { spawn as spawn2 } from "child_process";
import { readFileSync as readFileSync5, writeFileSync as writeFileSync4, existsSync as existsSync4, mkdirSync as mkdirSync3, readdirSync as readdirSync2 } from "fs";
import { join as join3 } from "path";

class MemoryPalace {
  memoryDir;
  palaceDir;
  skillPath;
  state = null;
  constructor(memoryDir, skillPath) {
    this.memoryDir = memoryDir;
    this.skillPath = skillPath;
    this.palaceDir = join3(memoryDir, ".palace");
  }
  async init(name, wings) {
    await this.runPython("palace_init.py", [
      this.palaceDir,
      "--wings",
      wings.join(","),
      "--name",
      name,
      "--force"
    ]);
    await this.load();
  }
  async load() {
    const palacePath = join3(this.palaceDir, "PALACE.md");
    if (!existsSync4(palacePath)) {
      this.state = null;
      return null;
    }
    const content = readFileSync5(palacePath, "utf-8");
    this.state = this.parsePalaceMd(content);
    return this.state;
  }
  async getHotCache() {
    const palacePath = join3(this.palaceDir, "PALACE.md");
    if (!existsSync4(palacePath))
      return "";
    return readFileSync5(palacePath, "utf-8");
  }
  async readWing(wingName) {
    const wingDir = join3(this.palaceDir, "wings", wingName);
    if (!existsSync4(wingDir))
      return [];
    const files = readdirSync2(wingDir).filter((f) => f.endsWith(".md"));
    return files.map((f) => readFileSync5(join3(wingDir, f), "utf-8"));
  }
  async saveNote(wing, note) {
    const wingDir = join3(this.palaceDir, "wings", wing);
    mkdirSync3(wingDir, { recursive: true });
    const filename = `${note.date}_${note.title.replace(/\s+/g, "-").toLowerCase()}.md`;
    const filepath = join3(wingDir, filename);
    const content = this.formatNote(note);
    writeFileSync4(filepath, content, "utf-8");
    await this.updateHotCache(wing, note);
    return filepath;
  }
  async autoSave(summary, wing, discoveries, decisions, dataPoints) {
    await this.runPython("palace_autosave.py", [
      this.palaceDir,
      "--summary",
      summary,
      "--wing",
      wing,
      ...discoveries ? ["--discoveries", discoveries] : [],
      ...decisions ? ["--decisions", decisions] : [],
      ...dataPoints ? ["--data", dataPoints] : []
    ]);
    await this.load();
  }
  async search(query, wing) {
    const args = [this.palaceDir, query, ...wing ? ["--wing", wing] : []];
    return this.runPython("palace_search.py", args);
  }
  async getStats() {
    return this.runPython("palace_stats.py", [this.palaceDir]);
  }
  async healthCheck() {
    return this.runPython("palace_health.py", [this.palaceDir]);
  }
  async generateMap() {
    return this.runPython("palace_map.py", [this.palaceDir]);
  }
  async archive(olderThanDays = 90) {
    return this.runPython("palace_archive.py", [
      this.palaceDir,
      "--archive-age",
      String(olderThanDays)
    ]);
  }
  async suggestTunnels() {
    if (!this.state)
      return [];
    const suggestions = [];
    const wings = this.state.wings.map((w) => w.name);
    for (let i = 0;i < wings.length; i++) {
      for (let j = i + 1;j < wings.length; j++) {
        const w1 = wings[i], w2 = wings[j];
        const existing = this.state.tunnels.find((t) => t.connects.includes(w1) && t.connects.includes(w2));
        if (!existing) {
          suggestions.push(`${w1} ↔ ${w2}`);
        }
      }
    }
    return suggestions;
  }
  async createTunnel(name, wingA, wingB, insight) {
    const tunnelDir = join3(this.palaceDir, "tunnels");
    mkdirSync3(tunnelDir, { recursive: true });
    const content = `# Tunnel: ${name}

> Created: ${new Date().toISOString().split("T")[0]}
> Connects: ${wingA} ↔ ${wingB}

## Core Insight
${insight}

## Where to Apply
`;
    writeFileSync4(join3(tunnelDir, `${name}.md`), content, "utf-8");
    await this.load();
  }
  exists() {
    return existsSync4(join3(this.palaceDir, "PALACE.md"));
  }
  getState() {
    return this.state;
  }
  getWingsDir() {
    return join3(this.palaceDir, "wings");
  }
  runPython(script, args = []) {
    return new Promise((resolve5, reject) => {
      const scriptPath = join3(this.skillPath, "scripts", script);
      const child = spawn2("python3", [scriptPath, ...args], {
        timeout: 30000
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => stdout += d.toString());
      child.stderr?.on("data", (d) => stderr += d.toString());
      child.on("close", (code) => {
        if (code === 0)
          resolve5(stdout);
        else
          reject(new Error(stderr || `Script exited with code ${code}`));
      });
      child.on("error", reject);
    });
  }
  parsePalaceMd(content) {
    const wings = [];
    const tunnels = [];
    const wingMatch = content.match(/## Wings Summary[\s\S]*?\|[\s\S]*?\n\n([\s\S]*?)(?=\n##|$)/);
    if (wingMatch) {
      const table = wingMatch[1];
      const rows = table.match(/\|[^|]+\|/g) || [];
      for (const row of rows.slice(2)) {
        const cols = row.split("|").map((c) => c.trim()).filter(Boolean);
        if (cols.length >= 5) {
          wings.push({
            name: cols[0],
            status: cols[1],
            lastUpdated: cols[2],
            keyInsights: cols[3],
            noteCount: parseInt(cols[4]) || 0
          });
        }
      }
    }
    const tunnelMatch = content.match(/## Tunnels[\s\S]*?\|[\s\S]*?\n\n([\s\S]*?)(?=\n##|$)/);
    if (tunnelMatch) {
      const table = tunnelMatch[1];
      const rows = table.match(/\|[^|]+\|/g) || [];
      for (const row of rows.slice(2)) {
        const cols = row.split("|").map((c) => c.trim()).filter(Boolean);
        if (cols.length >= 3) {
          tunnels.push({
            name: cols[0].replace(/[\[\]]/g, ""),
            connects: cols[1],
            coreInsight: cols[2]
          });
        }
      }
    }
    return {
      name: content.match(/# Memory Palace — (.+)/)?.[1] || "Memory Palace",
      wings,
      tunnels,
      lastUpdated: new Date().toISOString().split("T")[0]
    };
  }
  formatNote(note) {
    return `# ${note.title}

> Date: ${note.date}
> Source: ${note.source}
> Type: ${note.type}

## Key Content
${note.keyContent}

## Connection to Current Work
${note.connectionToCurrentWork}

${note.references ? `## References
${note.references}` : ""}
`;
  }
  async updateHotCache(wing, note) {
    const palacePath = join3(this.palaceDir, "PALACE.md");
    if (!existsSync4(palacePath))
      return;
    let content = readFileSync5(palacePath, "utf-8");
    const today = note.date;
    const wingLineMatch = content.match(new RegExp(`\\| ${wing} \\| ([^|]+) \\| ([^|]+) \\| ([^|]+) \\|`));
    if (wingLineMatch) {
      const newLine = `| ${wing} | active | ${today} | ${note.keyContent.split(`
`)[0].slice(0, 60)} | ${(parseInt(wingLineMatch[3]) || 0) + 1} |`;
      content = content.replace(wingLineMatch[0], newLine);
    }
    writeFileSync4(palacePath, content, "utf-8");
  }
}

// src/coordinator/Coordinator.ts
class Coordinator {
  llm;
  taskManager;
  workerPool;
  sessionStore;
  memoryPalace = null;
  memoryContext = "";
  context = "";
  projectRoot;
  sessionId;
  skillPath;
  constructor(projectRoot, sessionId, memoryDir, skillPath) {
    this.llm = new LLMClient;
    this.taskManager = new TaskStateMachine;
    this.workerPool = new WorkerPool;
    this.sessionStore = new SessionStore;
    this.projectRoot = projectRoot;
    this.sessionId = sessionId || this.generateSessionId();
    this.skillPath = skillPath || join4(process.cwd(), "..", "Mem-Palace-skill");
    if (memoryDir) {
      this.memoryPalace = new MemoryPalace(memoryDir, this.skillPath);
    }
  }
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  async init() {
    const ctx = await collectContext(this.projectRoot);
    this.context = buildWorkerSystemPrompt(ctx);
    if (this.memoryPalace && this.memoryPalace.exists()) {
      await this.memoryPalace.load();
      const hotCache = await this.memoryPalace.getHotCache();
      this.memoryContext = `

## \uD83C\uDFDB️ Memory Palace (Hot Cache)
${hotCache}
`;
      console.log("[Coordinator] Memory Palace loaded");
    }
    console.log(`[Coordinator] Session: ${this.sessionId}`);
    console.log("[Coordinator] Initialized");
  }
  async resume(sessionId) {
    const session = this.sessionStore.load(sessionId);
    if (!session)
      return false;
    this.sessionId = session.id;
    this.context = session.coordinatorContext;
    console.log(`[Coordinator] Resumed session: ${sessionId}`);
    return true;
  }
  save() {
    this.sessionStore.save({
      id: this.sessionId,
      projectRoot: this.projectRoot,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tasks: this.taskManager.getAll(),
      coordinatorContext: this.context,
      completedTaskIds: this.taskManager.getAll().filter((t) => t.status === "completed").map((t) => t.id),
      failedTaskIds: this.taskManager.getAll().filter((t) => t.status === "failed").map((t) => t.id)
    });
  }
  async handleUserTask(userPrompt) {
    console.log(`
[Coordinator] New task: ${userPrompt.slice(0, 80)}`);
    this.save();
    const plan = await this.plan(userPrompt);
    console.log(`[Coordinator] Planned ${plan.tasks.length} task(s)`);
    const results = await this.execute(plan.tasks);
    const response = await this.synthesize(userPrompt, results);
    await this.autoSaveToPalace(userPrompt, results);
    this.save();
    return response;
  }
  async plan(userPrompt) {
    const memorySection = this.memoryContext ? `

## Relevant Memory Palace Context
${this.memoryContext}

When planning, consider what was previously discussed in active wings.` : "";
    const systemPrompt = `You are an expert task planner for a coding agent.
Analyze the user's request and break it down into the smallest meaningful tasks.

Task types:
- research: Explore codebase, understand structure (can run in parallel with other research)
- implement: Write or modify code (requires file locks, runs after research for that area)
- verify: Check correctness, run tests (runs after implement)
- test: Execute test suites (runs after implement)
- review: Code review, suggestions (can run in parallel with other reviews)

Rules:
1. Research tasks can ALWAYS run in parallel with each other
2. Implement tasks should be split by FILE, not by step. One task = one file or one change
3. If two implement tasks touch the same file, MERGE them into one task
4. Verify/test tasks run AFTER the implement tasks they depend on
5. Output valid JSON with a "tasks" array
6. For dependsOn, use EXACT description strings of the tasks being depended on${memorySection}`;
    try {
      const response = await this.llm.call({
        messages: [{ role: "user", content: systemPrompt + `

User request: ` + userPrompt }],
        maxTokens: 2048
      });
      const cleaned = response.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(cleaned);
    } catch (e) {
      console.error("[Coordinator] Plan failed, using fallback:", e);
      return { tasks: [{ type: "implement", description: "Execute task", prompt: userPrompt }] };
    }
  }
  async execute(planTasks) {
    const results = new Map;
    const pending = new Map;
    const running = new Map;
    const descToId = new Map;
    const taskObjects = [];
    for (const pt of planTasks) {
      const task = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: pt.type,
        description: pt.description,
        prompt: pt.prompt,
        status: "pending",
        dependsOn: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      descToId.set(task.description, task.id);
      taskObjects.push(task);
      this.taskManager.add(task);
    }
    for (const task of taskObjects) {
      const pt = planTasks.find((p) => p.description === task.description);
      if (pt?.dependsOn) {
        task.dependsOn = pt.dependsOn.map((dep) => {
          const depStr = String(dep);
          const byDesc = descToId.get(depStr);
          if (byDesc)
            return byDesc;
          const m = depStr.match(/^task(\d+)$/);
          if (m)
            return taskObjects[parseInt(m[1]) - 1]?.id;
          const idx = parseInt(depStr);
          if (!isNaN(idx) && idx >= 0 && idx < taskObjects.length)
            return taskObjects[idx].id;
          for (const [desc, id] of descToId) {
            if (desc.slice(0, 25) === depStr.slice(0, 25))
              return id;
          }
          return null;
        }).filter(Boolean);
      }
      pending.set(task.id, task);
    }
    while (pending.size > 0 || running.size > 0) {
      for (const [taskId, pt] of pending) {
        const task = this.taskManager.get(taskId);
        if (this.canStart(taskId) && this.workerPool.getRunningCount() < API_CONFIG.maxConcurrentWorkers) {
          pending.delete(taskId);
          running.set(taskId, task);
          this.taskManager.start(taskId);
          console.log(`[Coordinator] Starting: ${task.description} (${task.type})`);
          const workerContext = this.context + this.memoryContext;
          this.workerPool.runWorker(task, workerContext).then((result) => {
            results.set(taskId, result);
            running.delete(taskId);
            if (result.status === "completed") {
              this.taskManager.complete(taskId, result.result);
            } else {
              this.taskManager.fail(taskId, result.result);
            }
            this.context += `

[TASK ${taskId} ${result.status}]: ${result.summary}`;
            console.log(`[Coordinator] ${task.description}: ${result.status}`);
          });
        }
      }
      if (pending.size > 0 && running.size === 0) {
        console.error("[Coordinator] DEADLOCK: No tasks can start");
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return results;
  }
  canStart(taskId) {
    const task = this.taskManager.get(taskId);
    if (task.status !== "pending")
      return false;
    if (!task.dependsOn?.length)
      return true;
    return task.dependsOn.every((depId) => {
      const dep = this.taskManager.get(depId);
      return dep && this.taskManager.isTerminal(dep.status);
    });
  }
  async synthesize(userPrompt, results) {
    const tasks = this.taskManager.getAll();
    const lines = [`## 任务完成
`];
    for (const task of tasks) {
      const result = results.get(task.id);
      const icon = result?.status === "completed" ? "✅" : "❌";
      lines.push(`${icon} **${task.description}** (${task.type})`);
      if (result) {
        lines.push(`   ${result.summary}`);
        if (result.status === "failed")
          lines.push(`   Error: ${String(result.result).slice(0, 200)}`);
      }
      lines.push("");
    }
    const synthesisPrompt = `Based on the user's original request and all task results, provide a clear summary.

User request: ${userPrompt}

Task results:
${tasks.map((t) => {
      const r = results.get(t.id);
      return `- [${r?.status || "unknown"}] ${t.description}: ${r?.summary || "no result"}`;
    }).join(`
`)}

Provide a concise summary of:
1. What was accomplished
2. Any errors or issues
3. What the user should know or do next`;
    try {
      const response = await this.llm.call({
        messages: [{ role: "user", content: synthesisPrompt }],
        maxTokens: 1024
      });
      lines.push(`## 总结
`);
      lines.push(response.content);
    } catch {
      lines.push(`
(Could not generate summary)`);
    }
    return lines.join(`
`);
  }
  async autoSaveToPalace(userPrompt, results) {
    if (!this.memoryPalace)
      return;
    const tasks = this.taskManager.getAll();
    const completed = tasks.filter((t) => t.status === "completed");
    const failed = tasks.filter((t) => t.status === "failed");
    if (completed.length === 0)
      return;
    const discoveries = completed.map((t) => results.get(t.id)?.summary).filter(Boolean).join("; ");
    const decisions = failed.length > 0 ? `Failed: ${failed.map((t) => t.description).join(", ")}` : "";
    const wing = this.detectWing(userPrompt);
    try {
      await this.memoryPalace.autoSave(`${userPrompt.slice(0, 50)}...`, wing || "general", discoveries, decisions);
      console.log("[Coordinator] Auto-saved to Memory Palace");
    } catch (e) {
      console.error("[Coordinator] Auto-save failed:", e);
    }
  }
  detectWing(prompt) {
    const lower = prompt.toLowerCase();
    if (lower.includes("research") || lower.includes("paper") || lower.includes("study"))
      return "research";
    if (lower.includes("infra") || lower.includes("deploy") || lower.includes("server"))
      return "infrastructure";
    if (lower.includes("test") || lower.includes("verify"))
      return "testing";
    if (lower.includes("design") || lower.includes("api") || lower.includes("feature"))
      return "product-development";
    return "general";
  }
}
function join4(...parts) {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
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
    const input = await new Promise((resolve5) => rl.question("> ", resolve5));
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
