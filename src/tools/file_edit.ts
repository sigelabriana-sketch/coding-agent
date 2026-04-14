// ============================================================
//  FileEditTool - 定向编辑文件
// ============================================================

import { readFileSync, writeFileSync } from 'fs'

export const FileEditTool = {
  name: 'FileEditTool',
  description: 'Edit a file by replacing specific text or inserting at positions',
  definition: {
    name: 'FileEditTool',
    description: 'Edit file contents in place',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        oldText: { type: 'string', description: 'Exact text to find and replace' },
        newText: { type: 'string', description: 'Replacement text' },
        insertAfter: { type: 'string', description: 'Insert after this text' },
        insertBefore: { type: 'string', description: 'Insert before this text' },
      },
      required: ['path'],
    },
  },

  async execute(input: Record<string, unknown>) {
    const path = input.path as string
    if (!path) return { success: false, output: '', error: 'path is required' }

    try {
      const content = readFileSync(path, 'utf-8')
      const oldText = input.oldText as string
      const newText = input.newText as string
      let newContent: string

      if (oldText && newText) {
        if (!content.includes(oldText)) {
          return { success: false, output: '', error: `oldText not found in file` }
        }
        newContent = content.replace(oldText, newText)
      } else if (input.insertAfter) {
        if (!content.includes(input.insertAfter as string)) {
          return { success: false, output: '', error: 'insertAfter text not found' }
        }
        newContent = content.replace(input.insertAfter as string, (input.insertAfter as string) + newText)
      } else if (input.insertBefore) {
        if (!content.includes(input.insertBefore as string)) {
          return { success: false, output: '', error: 'insertBefore text not found' }
        }
        newContent = content.replace(input.insertBefore as string, newText + (input.insertBefore as string))
      } else {
        return { success: false, output: '', error: 'Must provide oldText+newText or insertAfter or insertBefore' }
      }

      writeFileSync(path, newContent, 'utf-8')
      return { success: true, output: `Edited: ${path}` }
    } catch (e) {
      return { success: false, output: '', error: String(e) }
    }
  },
}
