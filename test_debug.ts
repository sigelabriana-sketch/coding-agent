// Debug what model actually calls
import { LLMClient } from './src/llm.js'
import { toolRegistry } from './src/tools/index.js'

async function main() {
  const llm = new LLMClient()
  const tools = toolRegistry.getDefinitions()

  const r = await llm.call({
    messages: [{
      role: 'user',
      content: `Create a file src/utils/HashMap.ts with this content:
\`\`\`typescript
export default class HashMap<K, V> {
  private map = new Map<K, V>();
  set(key: K, value: V) { this.map.set(key, value); }
  get(key: K): V | undefined { return this.map.get(key); }
  has(key: K): boolean { return this.map.has(key); }
  delete(key: K): boolean { return this.map.delete(key); }
  keys(): IterableIterator<K> { return this.map.keys(); }
  values(): IterableIterator<V> { return this.map.values(); }
  get size(): number { return this.map.size; }
}
\`\`\`
Use FileWriteTool to create this file.`
    }],
    tools,
    maxTokens: 1000,
  })

  console.log('Tool calls:', r.toolCalls)
  if (r.toolCalls?.length) {
    for (const tc of r.toolCalls) {
      const res = await toolRegistry.execute(tc.name, tc.input)
      console.log(`Tool ${tc.name}:`, res)
      console.log('  input:', tc.input)
    }
  }
}

main().catch(console.error)
