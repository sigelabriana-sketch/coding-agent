// Test: research task
import { Coordinator } from './src/coordinator/Coordinator.js'

async function main() {
  const coordinator = new Coordinator('/Users/nigo/Desktop/特朗普的办公室/10-CodingAgent')
  await coordinator.init()

  const result = await coordinator.handleUserTask(
    'Research task: explore the src/tools directory and report what tools are implemented, their file sizes, and what each one does in a summary table.'
  )

  console.log(result)
}

main().catch(console.error)
