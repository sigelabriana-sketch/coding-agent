// ============================================================
//  Coding Agent 配置
// ============================================================

export const API_CONFIG = {
  // MiniMax M2.7 代理地址
  baseUrl: process.env.ANTHROPIC_BASE_URL || 'http://localhost:8080',
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN || 'sk-test',
  model: process.env.ANTHROPIC_MODEL || 'astron-code-latest',
  
  // 请求配置
  maxTokens: 8192,
  temperature: 0,
  
  // 工具配置 - 文件操作命令白名单
  allowedCommands: [
    'git', 'npm', 'node', 'bun', 'ls', 'cat', 'grep', 'find', 'echo', 'pwd',
    'mkdir', 'touch', 'cp', 'mv', 'rm', 'chmod', 'chown',
    'wc', 'head', 'tail', 'sort', 'uniq', 'cut', 'tr',
    'cd', 'pwd', 'test',
  ],

  maxConcurrentWorkers: 4,
  workerIdleTimeoutMs: 300000,
  
  // 预算控制
  maxTokensPerRequest: 8192,
  requestTimeoutMs: 60000,
}
