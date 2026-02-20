import { access, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ path: string }>(event)

  if (!body?.path) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required field: path',
    })
  }

  // Expand ~ to home directory (shell doesn't expand it in HTTP requests)
  const expanded = body.path.startsWith('~/')
    ? join(process.env.HOME ?? process.env.USERPROFILE ?? '', body.path.slice(1))
    : body.path
  const projectPath = resolve(expanded)

  // Validate directory exists
  try {
    const st = await stat(projectPath)
    if (!st.isDirectory()) {
      throw createError({
        statusCode: 400,
        statusMessage: `Not a directory: ${projectPath}`,
      })
    }
  }
  catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    throw createError({
      statusCode: 400,
      statusMessage: `Path does not exist: ${projectPath}`,
    })
  }

  // Validate it's a git repo
  const gitDir = join(projectPath, '.git')
  try {
    await access(gitDir)
  }
  catch {
    throw createError({
      statusCode: 400,
      statusMessage: `Not a git repository: ${projectPath}. Run 'git init' first.`,
    })
  }

  // Create .pelley directory
  const pelleyDir = join(projectPath, '.pelley')
  await mkdir(pelleyDir, { recursive: true })

  // Create empty models.json if it doesn't exist
  const modelsPath = join(pelleyDir, 'models.json')
  try {
    await access(modelsPath)
  }
  catch {
    await writeFile(modelsPath, '{}', 'utf-8')
  }

  // Add .pelley/ to .gitignore if not already present
  const gitignorePath = join(projectPath, '.gitignore')
  let gitignoreContent = ''
  try {
    gitignoreContent = await readFile(gitignorePath, 'utf-8')
  }
  catch {
    // No .gitignore yet — will create one
  }

  const lines = gitignoreContent.split('\n')
  if (!lines.some(line => line.trim() === '.pelley/')) {
    const separator = gitignoreContent.length > 0 && !gitignoreContent.endsWith('\n') ? '\n' : ''
    await writeFile(gitignorePath, gitignoreContent + separator + '.pelley/\n', 'utf-8')
  }

  return { ok: true, path: projectPath }
})
