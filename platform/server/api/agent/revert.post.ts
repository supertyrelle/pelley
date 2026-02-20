import { writeFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { useProjectManager } from '~~/server/services/project-manager'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    filePath: string
    before: string
  }>(event)

  if (!body?.filePath || typeof body.filePath !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'filePath is required' })
  }
  if (typeof body.before !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'before (string) is required' })
  }

  // Resolve project root
  const project = useProjectManager().getActiveProject()
  if (!project) {
    throw createError({ statusCode: 400, statusMessage: 'No active project' })
  }

  const projectRoot = project.path

  // Validate filePath: must resolve within the project root (no path traversal)
  const targetPath = isAbsolute(body.filePath)
    ? resolve(body.filePath)
    : resolve(projectRoot, body.filePath)

  const relativePath = relative(projectRoot, targetPath)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'filePath must be within the active project root',
    })
  }

  try {
    await writeFile(targetPath, body.before, 'utf-8')
    return { success: true, filePath: body.filePath }
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to write file'
    throw createError({ statusCode: 500, statusMessage: message })
  }
})
