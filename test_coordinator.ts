// Test full Coordinator flow
import { Coordinator } from './src/coordinator/Coordinator.js'

async function main() {
  console.log('Testing Coordinator...')
  const coordinator = new Coordinator('/tmp')
  await coordinator.init()
  
  const result = await coordinator.handleUserTask(
    'Create a file hello.txt with content "Hello from MiniMax M2.7!"'
  )
  
  console.log('\nResult:\n', result)
  console.log('✅ Coordinator test complete!')
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1) })
