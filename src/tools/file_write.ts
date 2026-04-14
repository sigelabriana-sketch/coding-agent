// ============================================================
//  FileWriteTool - 创建/覆盖文件
// ============================================================

import { writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve, isAbsolute } from 'path'

export const FileWriteTool = {
  name: 'FileWriteTool',
  description: 'Create a new file or overwrite an existing file',
  definition: {
    name: 'FileWriteTool',
    description: 'Write or create a file',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    },
  },

  async execute(input: Record<string, unknown>) {
    const path = input.path as string
    const content = input.content as string
    if (!path || content === undefined) {
      return { success: false, output: '', error: 'path and content are required' }
    }

    try {
      // 解析为绝对路径
      const absPath = isAbsolute(path) ? path : resolve(process.cwd(), path)
      mkdirSync(dirname(absPath), { recursive: true })
      writeFileSync(absPath, content, 'utf-8')
      return { success: true, output: `Written: ${absPath}` }
    } catch (e) {
      return { success: false, output: '', error: String(e) }
    }
  },
}
