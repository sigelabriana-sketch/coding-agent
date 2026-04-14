// Test tool calls
import { LLMClient } from './src/llm.js'
import { toolRegistry } from './src/tools/index.js'

async function main() {
  const llm = new LLMClient()
  console.log('Testing tool calls...')
  
  // Test bash tool
  const r = await llm.call({
    messages: [{
      role: 'user',
      content: 'Run: echo "hello from tools"'
    }],
    tools: toolRegistry.getDefinitions(),
    maxTokens: 500,
  })
  
  console.log('Content:', r.content)
  console.log('Tool calls:', r.toolCalls?.map(tc => ({ name: tc.name, input: tc.input })))
  
  if (r.toolCalls?.length) {
    for (const tc of r.toolCalls) {
      const result = await toolRegistry.execute(tc.name, tc.input)
      console.log(`\nTool ${tc.name} result:`, result)
    }
  }
  
  console.log('✅ Tool test complete!')
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1) })
