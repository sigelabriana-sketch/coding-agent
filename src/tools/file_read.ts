// ============================================================
//  FileReadTool - 读取文件
// ============================================================

import { readFileSync, statSync, existsSync } from 'fs'
import { resolve, isAbsolute } from 'path'

export const FileReadTool = {
  name: 'FileReadTool',
  description: 'Read the contents of a file',
  definition: {
    name: 'FileReadTool',
    description: 'Read file contents',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file' },
        offset: { type: 'number', description: 'Line offset (0-indexed)' },
        limit: { type: 'number', description: 'Max lines to read' },
      },
      required: ['path'],
    },
  },

  async execute(input: Record<string, unknown>) {
    let path = input.path as string
    if (!path) return { success: false, output: '', error: 'path is required' }

    // 如果是相对路径，需要基于当前工作目录解析
    if (!isAbsolute(path)) {
      path = resolve(process.cwd(), path)
    }

    if (!existsSync(path)) {
      return { success: false, output: '', error: `File not found: ${path}` }
    }

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
