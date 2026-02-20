import { resolve } from 'node:path'

/**
 * Resolve the project root directory.
 *
 * Priority:
 *   1. PROJECT_PATH env var (explicit override for deployed builds)
 *   2. process.cwd() (works for both `nuxt dev` and standalone server)
 *
 * The returned path is always absolute.
 */
export function resolveProjectRoot(): string {
  const envPath = process.env.PROJECT_PATH
  if (envPath) {
    return resolve(envPath)
  }
  return process.cwd()
}
