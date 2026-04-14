import { LLMClient } from './src/llm.ts'

async function main() {
  const llm = new LLMClient()
  console.log('Testing system role...')

  const r = await llm.call({
    systemPrompt: 'You are a helpful assistant. Reply with one word.',
    messages: [{ role: 'user', content: 'Hello!' }],
    maxTokens: 100,
  })

  console.log('Content:', r.content)
  console.log('Stop:', r.stopReason)
  console.log('✅ System role test complete!')
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1) })
