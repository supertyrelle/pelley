export interface Bead {
  id: string
  title: string
  type: 'task' | 'epic' | 'bug' | 'spike' | 'feature' | 'chore' | 'decision'
  status: 'open' | 'in-progress' | 'closed' | 'blocked' | 'deferred'
  priority?: number
  parent?: string
  description?: string
  blockedBy?: string[]
  blocks?: string[]
  createdAt?: string
  updatedAt?: string
  owner?: string
  assignee?: string
  labels?: string[]
}

export interface BeadStats {
  total: number
  open: number
  closed: number
  inProgress: number
  blocked: number
  deferred: number
  ready: number
}

export interface BeadUpdate {
  title?: string
  priority?: string
  description?: string
  status?: string
  assignee?: string
  labels?: string[]
}

export interface EpicStatus {
  id: string
  title: string
  status: string
  completionPercent: number
  childrenTotal: number
  childrenClosed: number
  eligibleForClose: boolean
}

export type BeadEventType =
  | 'bead:created'
  | 'bead:updated'
  | 'bead:closed'
  | 'bead:stats-changed'

export interface BeadEvent {
  type: BeadEventType
  bead?: Bead
  stats?: BeadStats
  timestamp: number
}
