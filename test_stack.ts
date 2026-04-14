// Test: create Stack and Queue
import { Coordinator } from './src/coordinator/Coordinator.js'

async function main() {
  const coordinator = new Coordinator('/Users/nigo/Desktop/特朗普的办公室/10-CodingAgent')
  await coordinator.init()
  const result = await coordinator.handleUserTask('Create src/utils/Stack.ts with a TypeScript generic Stack class (push/pop/peek/isEmpty/size). Export the class.')
  console.log(result)
}

main().catch(console.error)
