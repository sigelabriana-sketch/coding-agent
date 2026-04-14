// ============================================================
//  FileReadTool - 读取文件
// ============================================================

import { readFileSync, statSync } from 'fs'

export const FileReadTool = {
  name: 'FileReadTool',
  description: 'Read the contents of a file',
  definition: {
    name: 'FileReadTool',
    description: 'Read file contents',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        offset: { type: 'number', description: 'Line offset to start reading from (0-indexed)' },
        limit: { type: 'number', description: 'Maximum number of lines to read' },
      },
      required: ['path'],
    },
  },

  async execute(input: Record<string, unknown>) {
    const path = input.path as string
    if (!path) return { success: false, output: '', error: 'path is required' }

    try {
      const stat = statSync(path)
      if (!stat.isFile()) return { success: false, output: '', error: 'Not a file' }

      const offset = (input.offset as number) || 0
      const limit = (input.limit as number) || Infinity

      const content = readFileSync(path, 'utf-8')
      const lines = content.split('\n')
      const selected = lines.slice(offset, offset + limit)

      return {
        success: true,
        output: `File: ${path}\nLines: ${offset + 1}-${offset + selected.length}/${lines.length}\n\n${selected.join('\n')}`,
      }
    } catch (e) {
      return { success: false, output: '', error: String(e) }
    }
  },
}
