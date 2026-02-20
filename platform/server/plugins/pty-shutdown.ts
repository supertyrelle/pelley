import { ptyManager } from '~~/server/services/pty-manager'

export default defineNitroPlugin((nitro) => {
  // Run PTY health check at startup
  const health = ptyManager.checkHealth()
  if (health.healthy) {
    console.log('[pty] node-pty loaded successfully')
  }
  else {
    console.warn('[pty] node-pty not available:', health.error)
  }

  // Kill all PTY sessions on server shutdown
  nitro.hooks.hook('close', () => {
    console.log('[pty] Shutting down, killing all PTY sessions...')
    ptyManager.killAll()
  })
})
