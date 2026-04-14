# Phase 0: API 对接验证报告

**日期**: 2026-04-15
**验证人**: 小创

---

## 1. API 连通性

| 测试项 | 结果 | 说明 |
|--------|------|------|
| 代理端口 8080 | ✅ 通过 | HTTP 200 响应 |
| Claude Code CLI 版本 | ✅ 2.1.92 | 正常识别 |
| 模型路由 | ✅ 通过 | MiniMax M2.7 正确响应 |

**验证命令**:
```bash
ANTHROPIC_BASE_URL=http://localhost:8080 ANTHROPIC_AUTH_TOKEN=sk-test claude --version
# 输出: 2.1.92 (Claude Code)
```

---

## 2. 流式响应格式

**SSE 事件流**（`curl --stream`）:

```
message_start → content_block_start (thinking) → content_block_delta (thinking) × N
             → content_block_stop → content_block_start (text) → content_block_delta (text) × N
             → content_block_stop → message_delta → message_stop
```

**关键发现**:
- MiniMax M2.7 开启了 `thinking` 块（Anthropic extended thinking）
- thinking 块先于 text 块输出
- thinking 内容占用大量 output token
- text 内容在 thinking 结束后才开始输出

---

## 3. Claude Code CLI `--print` 模式

### 关键发现

**不加 `--output-format text` 时会挂住**（streaming 模式被阻塞）：
```bash
# ❌ 挂住 - 流式输出被阻塞
claude --print 'Say hello'
```

**加 `--output-format text` 后正常工作**:
```bash
# ✅ 正常 - 输出 "hello"
claude --print --output-format text 'Say exactly: hello'
# 输出: hello
```

### `--print` 模式测试结果

| 任务 | 命令 | 结果 |
|------|------|------|
| 纯文本回复 | `claude --print --output-format text 'Say exactly: hello'` | ✅ 输出 "hello" |
| Bash 命令执行 | `claude --print --output-format text 'Execute: echo "hello from minimax"'` | ✅ 输出 "hello from minimax" |
| 文件写入 | `claude --print --output-format text 'Write a file hello.txt with content "hello"'` | ⚠️ 触发权限确认（预期行为） |

### `--output-format` 选项

| 格式 | 说明 |
|------|------|
| `text` (默认) | 打印最终文本响应 |
| `json` | JSON 结构化输出 |
| `stream-json` | 实时流式 JSON |

---

## 4. Phase 1 影响分析

### 需要处理的问题

1. **thinking 块消耗 token 预算**
   - MiniMax M2.7 默认开启 extended thinking
   - 需要在 API 请求时加 `thinking: { type: 'disabled' }` 或加大 max_tokens
   - Claude Code CLI 层需要在调用 LLM 前禁用 thinking

2. **文件写入权限确认**
   - `--print` 模式下文件写入会触发权限确认，无法自动完成
   - Phase 1 需要配置允许写入的目录白名单
   - 方案：设置 `ANTHROPIC_ALLOW_WRITES=true` 或使用 `--dangerously-skip-permissions`

3. **流式响应解析**
   - Claude Code 需要解析 SSE 格式的 thinking + text 块
   - 需要特殊处理 thinking 块（丢弃或截断）

---

## 5. 配置记录

```bash
# 环境变量
export ANTHROPIC_BASE_URL=http://localhost:8080
export ANTHROPIC_AUTH_TOKEN=sk-test

# 常用命令格式
claude --print --output-format text '<task>'
```

---

## 6. 结论

| 验收项 | 状态 |
|--------|------|
| API 连通性 | ✅ 通过 |
| 流式响应格式 | ✅ 可解析 |
| Claude Code `--print` 模式 | ✅ 可用（需加 `--output-format text`） |
| Bash 工具调用 | ✅ 正常工作 |
| 文件写入 | ⚠️ 需配置权限白名单 |

**Phase 1 启动条件**: ✅ 满足
