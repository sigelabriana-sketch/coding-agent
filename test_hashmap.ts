// Test: create HashMap
import { Coordinator } from './src/coordinator/Coordinator.js'

async function main() {
  const coordinator = new Coordinator('/Users/nigo/Desktop/特朗普的办公室/10-CodingAgent')
  await coordinator.init()
  const result = await coordinator.handleUserTask('Create src/utils/HashMap.ts with a TypeScript generic HashMap class. Include: set(key, value), get(key), has(key), delete(key), keys(), values(), size. Use a Map internally. Export the class.')
  console.log(result)
}

main().catch(console.error)
