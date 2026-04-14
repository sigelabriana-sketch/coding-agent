// Test: multi-file project setup
import { Coordinator } from './src/coordinator/Coordinator.js'

async function main() {
  const coordinator = new Coordinator('/Users/nigo/Desktop/特朗普的办公室/10-CodingAgent')
  await coordinator.init()

  const result = await coordinator.handleUserTask(
    'Create a new project structure: create src/utils/Stack.ts with a TypeScript Stack class (push/pop/peek/isEmpty), and create src/utils/Queue.ts with a TypeScript Queue class (enqueue/dequeue/front/isEmpty). Both should use generics.'
  )

  console.log(result)
}

main().catch(console.error)
