export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'
export type ContextScope = 'shared' | 'isolated'

export interface Task {
  id: string              // bead ID
  title: string
  agentId: string         // assigned agent
  sessionId?: string      // active terminal session
  worktreePath?: string   // git worktree path
  status: TaskStatus
  contextScope: ContextScope
  projectPath: string
  useWorktree: boolean
  createdAt: number       // epoch ms
  updatedAt: number       // epoch ms
}

export interface CreateTaskOptions {
  title: string
  agentId: string
  projectPath: string
  useWorktree?: boolean
  contextScope?: ContextScope
}

export type TaskEventType =
  | 'task:created'
  | 'task:started'
  | 'task:stopped'
  | 'task:closed'
  | 'task:failed'

export interface TaskEvent {
  type: TaskEventType
  task: Task
  timestamp: number
}
