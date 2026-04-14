// Test: create Queue with mkdir
import { Coordinator } from './src/coordinator/Coordinator.js'

async function main() {
  const coordinator = new Coordinator('/Users/nigo/Desktop/特朗普的办公室/10-CodingAgent')
  await coordinator.init()
  const result = await coordinator.handleUserTask('Create a new directory src/data-structures if it does not exist, then create src/data-structures/Queue.ts with a TypeScript generic Queue class (enqueue/dequeue/front/isEmpty/size). Export the class.')
  console.log(result)
}

main().catch(console.error)
