import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import type { DiffFile, ChangedFile } from '~~/shared/types/diff'

const execFileAsync = promisify(execFile)

/**
 * Run a git command safely using execFile (no shell interpolation).
 * Returns { stdout, stderr }. Throws on non-zero exit with a descriptive error.
 */
async function git(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 })
  }
  catch (err: unknown) {
    const e = err as { stderr?: string; code?: number; message?: string }
    const detail = e.stderr?.trim() || e.message || 'unknown git error'
    throw new Error(`git ${args[0]} failed: ${detail}`)
  }
}

/**
 * Parse unified diff output into structured DiffFile objects.
 *
 * Splits on `diff --git` boundaries, extracts file paths and status
 * from the header lines, and counts +/- lines per file.
 */
function parseUnifiedDiff(raw: string): DiffFile[] {
  if (!raw.trim()) return []

  const files: DiffFile[] = []
  // Split on diff headers, keeping the delimiter
  const chunks = raw.split(/^(?=diff --git )/m).filter(Boolean)

  for (const chunk of chunks) {
    const lines = chunk.split('\n')

    // Parse "diff --git a/path b/path"
    const headerMatch = lines[0]?.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (!headerMatch) continue

    const oldPath = headerMatch[1]!
    const newPath = headerMatch[2]!

    // Determine status from diff metadata lines
    let status: DiffFile['status'] = 'modified'
    if (lines.some(l => l.startsWith('new file mode'))) {
      status = 'added'
    }
    else if (lines.some(l => l.startsWith('deleted file mode'))) {
      status = 'deleted'
    }
    else if (lines.some(l => l.startsWith('rename from'))) {
      status = 'renamed'
    }

    // Count additions and deletions (lines starting with + or - after @@)
    let additions = 0
    let deletions = 0
    let inHunk = false

    for (const line of lines) {
      if (line.startsWith('@@')) {
        inHunk = true
        continue
      }
      if (!inHunk) continue

      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++
      }
      else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++
      }
    }

    const file: DiffFile = {
      path: newPath,
      status,
      additions,
      deletions,
      rawDiff: chunk,
    }

    if (status === 'renamed' && oldPath !== newPath) {
      file.oldPath = oldPath
    }

    files.push(file)
  }

  return files
}

/**
 * Map git status letters to ChangedFile status.
 */
function mapStatus(letter: string): ChangedFile['status'] {
  switch (letter) {
    case 'A': return 'A'
    case 'D': return 'D'
    case 'M': return 'M'
    default:
      // Rxy (rename with similarity) -> R
      if (letter.startsWith('R')) return 'R'
      return 'M'
  }
}

// ---------------------------------------------------------------------------
// GitDiffService
// ---------------------------------------------------------------------------

export class GitDiffService {
  /**
   * Get structured diff output for a project.
   *
   * Options:
   * - staged: diff only staged changes (--staged)
   * - branch: diff against a branch (branch...HEAD)
   * - default: diff working tree against index (unstaged changes)
   */
  async getDiff(
    projectPath: string,
    options?: { branch?: string; staged?: boolean },
  ): Promise<DiffFile[]> {
    const cwd = resolve(projectPath)
    await this.assertGitRepo(cwd)

    const args = ['diff']

    if (options?.staged) {
      args.push('--staged')
    }
    else if (options?.branch) {
      args.push(`${options.branch}...HEAD`)
    }

    // Include rename detection
    args.push('-M')

    const { stdout } = await git(args, cwd)
    return parseUnifiedDiff(stdout)
  }

  /**
   * Get a list of changed files with their status letters.
   *
   * When baseBranch is provided, compares baseBranch...HEAD.
   * Otherwise shows unstaged + staged changes.
   */
  async getChangedFiles(
    projectPath: string,
    baseBranch?: string,
  ): Promise<ChangedFile[]> {
    const cwd = resolve(projectPath)
    await this.assertGitRepo(cwd)

    const files: ChangedFile[] = []

    if (baseBranch) {
      const { stdout } = await git(
        ['diff', '--name-status', '-M', `${baseBranch}...HEAD`],
        cwd,
      )
      for (const line of stdout.split('\n').filter(Boolean)) {
        const [statusLetter, ...pathParts] = line.split('\t')
        if (!statusLetter || pathParts.length === 0) continue
        // For renames, pathParts has [oldPath, newPath]; use the new path
        const filePath = pathParts[pathParts.length - 1]!
        files.push({ path: filePath, status: mapStatus(statusLetter) })
      }
    }
    else {
      // Combine staged and unstaged changes
      const [staged, unstaged] = await Promise.all([
        git(['diff', '--name-status', '-M', '--staged'], cwd),
        git(['diff', '--name-status', '-M'], cwd),
      ])

      const seen = new Set<string>()

      for (const output of [staged.stdout, unstaged.stdout]) {
        for (const line of output.split('\n').filter(Boolean)) {
          const [statusLetter, ...pathParts] = line.split('\t')
          if (!statusLetter || pathParts.length === 0) continue
          const filePath = pathParts[pathParts.length - 1]!
          if (seen.has(filePath)) continue
          seen.add(filePath)
          files.push({ path: filePath, status: mapStatus(statusLetter) })
        }
      }
    }

    return files
  }

  private async assertGitRepo(dir: string): Promise<void> {
    try {
      await git(['rev-parse', '--git-dir'], dir)
    }
    catch {
      throw new Error(`Not a git repository: ${dir}`)
    }
  }
}

/** Singleton instance shared across the server. */
export const gitDiffService = new GitDiffService()
