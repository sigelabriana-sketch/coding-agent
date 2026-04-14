// Debug: test file write flow
import { LLMClient } from './src/llm.js'
import { toolRegistry } from './src/tools/index.js'

async function main() {
  const llm = new LLMClient()
  const tools = toolRegistry.getDefinitions()

  // Ask model to create a file
  const r1 = await llm.call({
    messages: [{
      role: 'user',
      content: `You are in IMPLEMENT mode. Write a file /tmp/test_agent.txt with content "Hello from MiniMax!".
Available tools: BashTool, FileReadTool, FileEditTool, FileWriteTool.
Use FileWriteTool to create the file.`
    }],
    tools,
    maxTokens: 1000,
  })

  console.log('=== Step 1 ===')
  console.log('Content:', r1.content.slice(0, 200))
  console.log('Tool calls:', r1.toolCalls?.map(tc => tc.name))

  if (r1.toolCalls?.length) {
    for (const tc of r1.toolCalls) {
      const result = await toolRegistry.execute(tc.name, tc.input)
      console.log(`\nTool ${tc.name}:`, result)

      // Follow-up
      const r2 = await llm.call({
        messages: [
          { role: 'user', content: `Task result: ${tc.name} returned ${JSON.stringify(result)}` },
        ],
        tools,
        maxTokens: 500,
      })
      console.log('\n=== Step 2 ===')
      console.log('Content:', r2.content)
    }
  }

  // Check if file exists
  const { existsSync } = await import('fs')
  console.log('\n=== File check ===')
  console.log('File exists:', existsSync('/tmp/test_agent.txt'))
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1) })
