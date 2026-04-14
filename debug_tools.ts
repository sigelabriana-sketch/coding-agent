// Debug: test tool call + follow-up
import { LLMClient } from './src/llm.js'
import { toolRegistry } from './src/tools/index.js'

async function main() {
  const llm = new LLMClient()
  
  // Step 1: Ask for a tool call
  const r1 = await llm.call({
    messages: [{ role: 'user', content: 'Run: echo "hello from minimax"' }],
    tools: toolRegistry.getDefinitions(),
    maxTokens: 500,
  })
  
  console.log('Step 1 - Tool calls:', r1.toolCalls)
  
  if (r1.toolCalls?.length) {
    const tc = r1.toolCalls[0]
    const toolResult = await toolRegistry.execute(tc.name, tc.input)
    console.log('Tool result:', toolResult)
    
    // Step 2: Follow-up with tool result
    // Note: MiniMax doesn't support system role, so we prepend context
    const followUp = await llm.call({
      messages: [
        { role: 'user', content: `Tool result: ${tc.name} returned: ${toolResult.output}\n\nNow respond with an XML task-notification block to confirm completion.` },
      ],
      maxTokens: 500,
    })
    
    console.log('Step 2 - Content:', followUp.content)
  }
  
  console.log('✅ Debug complete!')
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1) })
