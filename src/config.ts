// ============================================================
//  Coding Agent 配置
// ============================================================

export const API_CONFIG = {
  // MiniMax M2.7 代理地址
  baseUrl: process.env.ANTHROPIC_BASE_URL || 'http://localhost:8080',
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN || 'sk-test',
  model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241027',
  
  // 请求配置
  maxTokens: 8192,
  temperature: 0,
  
  // 工具配置
  allowedCommands: ['git', 'npm', 'node', 'bun', 'ls', 'cat', 'grep', 'find', 'echo', 'pwd'],
  maxConcurrentWorkers: 4,
  workerIdleTimeoutMs: 300000,
  
  // 预算控制
  maxTokensPerRequest: 8192,
  requestTimeoutMs: 60000,
}
