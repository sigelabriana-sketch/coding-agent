// Simple API test
import { LLMClient } from './src/llm.js'

async function main() {
  const llm = new LLMClient()
  console.log('Testing MiniMax M2.7 API...')
  
  const r = await llm.call({
    messages: [{ role: 'user', content: 'Say exactly one word: hello' }],
    maxTokens: 100,
  })
  
  console.log('Content:', r.content)
  console.log('Stop:', r.stopReason)
  console.log('Tool calls:', r.toolCalls?.length)
  console.log('✅ API test complete!')
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1) })
