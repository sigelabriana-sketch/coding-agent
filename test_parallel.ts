// Test: parallel tasks with new architecture
import { Coordinator } from './src/coordinator/Coordinator.js'

async function main() {
  const coordinator = new Coordinator('/Users/nigo/Desktop/特朗普的办公室/10-CodingAgent')
  await coordinator.init()
  
  // 多任务并行测试：research + 多个 implement
  const result = await coordinator.handleUserTask(
    `Research the src directory structure, then create all of the following in parallel:
    1. src/utils/Tree.ts - Binary Tree class with insert/inOrder/traverse
    2. src/utils/Graph.ts - Graph class with addEdge/BFS/DFS
    3. src/utils/Heap.ts - MinHeap class with push/pop/peek`
  )
  console.log('\n=== FINAL RESULT ===\n')
  console.log(result)
}

main().catch(console.error)
