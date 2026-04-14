// Debug mkdir
import { toolRegistry } from './src/tools/index.js'

async function main() {
  const r = await toolRegistry.execute('BashTool', { command: 'mkdir -p /tmp/test-claude-dir && echo "OK"' })
  console.log('Result:', r)
  const r2 = await toolRegistry.execute('BashTool', { command: 'mkdir -p ~/Desktop/特朗普的办公室/10-CodingAgent/src/data-structures && echo "OK"' })
  console.log('Result2:', r2)
}

main().catch(console.error)
