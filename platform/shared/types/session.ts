export interface TerminalSession {
  id: string
  agentId: string
  status: 'starting' | 'running' | 'stopped' | 'error'
  contextScope: 'shared' | 'isolated'
  createdAt: Date
  projectPath: string
  worktreePath?: string
}
