// ---------------------------------------------------------------------------
// Agent Driver Protocol Types
// ---------------------------------------------------------------------------
// Structured event protocol for programmatic agent communication.
// Parallel to the PTY/xterm.js terminal path — same agents, typed events
// instead of raw terminal output.
//
// Transport: SSE frames as `data: JSON\n\n`. Every event carries a `type`
// discriminator, a monotonic `seq` for ordering, and a `timestamp`.
// ---------------------------------------------------------------------------

import type { ModelRouteConfig } from './model'

// ---------------------------------------------------------------------------
// Event base
// ---------------------------------------------------------------------------

export interface AgentDriverEventBase {
  type: string
  /** Monotonic sequence number for ordering within a session */
  seq: number
  /** Unix epoch milliseconds */
  timestamp: number
}

// ---------------------------------------------------------------------------
// Event variants
// ---------------------------------------------------------------------------

export interface TextDeltaEvent extends AgentDriverEventBase {
  type: 'text-delta'
  content: string
}

export interface ToolCallStartEvent extends AgentDriverEventBase {
  type: 'tool-call-start'
  callId: string
  toolName: string
  input: Record<string, unknown>
}

export interface ToolCallResultEvent extends AgentDriverEventBase {
  type: 'tool-call-result'
  callId: string
  toolName: string
  output: string
  /** Wall-clock duration in milliseconds */
  duration: number
  status: 'success' | 'error'
}

export interface ApprovalRequestEvent extends AgentDriverEventBase {
  type: 'approval-request'
  requestId: string
  action: string
  affectedFiles: string[]
  toolName: string
}

export interface ApprovalResponseEvent extends AgentDriverEventBase {
  type: 'approval-response'
  requestId: string
  approved: boolean
  alwaysAllow?: boolean
}

// ---------------------------------------------------------------------------
// Structured diff detail for inline diff rendering
// ---------------------------------------------------------------------------

export interface EditOperation {
  /** 1-based start line in the original file */
  startLine: number
  /** 1-based end line in the original file (inclusive). Equal to startLine for single-line edits */
  endLine: number
  /** Replacement content (empty string for pure deletions) */
  replacement: string
}

/**
 * Richer diff representation with line-level edit operations.
 *
 * To convert to DiffFile (from shared/types/diff.ts):
 *   - filePath -> DiffFile.path
 *   - Compute additions/deletions by counting replacement vs original lines across editOperations
 *   - Generate rawDiff by applying editOperations to before/after content in unified diff format
 *   - Derive DiffFile.status from the parent FileChangeEvent.editType
 */
export interface AgentDiffDetail {
  filePath: string
  editOperations: EditOperation[]
  /** Full file content before changes (undefined for new files) */
  before?: string
  /** Full file content after all changes applied */
  after: string
}

export interface FileChangeEvent extends AgentDriverEventBase {
  type: 'file-change'
  filePath: string
  before?: string
  after: string
  editType: 'create' | 'edit' | 'delete'
  /** Structured diff for inline rendering; optional for backward compatibility */
  diff?: AgentDiffDetail
}

export interface ThinkingEvent extends AgentDriverEventBase {
  type: 'thinking'
  /** Whether thinking is actively in progress (true=start/delta, false=end) */
  active: boolean
  phase?: string
  content?: string
}

export interface ProgressEvent extends AgentDriverEventBase {
  type: 'progress'
  message: string
  /** 0-100 */
  percentage?: number
}

export interface ErrorEvent extends AgentDriverEventBase {
  type: 'error'
  message: string
  code?: string
  fatal: boolean
}

export interface CompleteEvent extends AgentDriverEventBase {
  type: 'complete'
  summary?: string
  tokensUsed?: { input: number; output: number }
}

export interface UsageEvent extends AgentDriverEventBase {
  type: 'usage'
  inputTokens: number
  outputTokens: number
}

export interface ReadyEvent extends AgentDriverEventBase {
  type: 'ready'
}

export interface UserMessageEvent extends AgentDriverEventBase {
  type: 'user-message'
  content: string
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export type AgentDriverEvent =
  | TextDeltaEvent
  | ToolCallStartEvent
  | ToolCallResultEvent
  | ApprovalRequestEvent
  | ApprovalResponseEvent
  | FileChangeEvent
  | ThinkingEvent
  | ProgressEvent
  | ErrorEvent
  | CompleteEvent
  | UsageEvent
  | ReadyEvent
  | UserMessageEvent

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface AgentDriverSession {
  id: string
  agentId: string
  status: 'starting' | 'idle' | 'running' | 'waiting-approval' | 'complete' | 'error'
  createdAt: Date
  modelConfig: ModelRouteConfig
  /** ID of the session this was branched from, if any. */
  parentSessionId?: string
  /** Sequence number at which this branch diverged from the parent. */
  branchPoint?: number
}

// ---------------------------------------------------------------------------
// Requests (client -> server)
// ---------------------------------------------------------------------------

export interface PromptRequest {
  type: 'prompt'
  message: string
}

export interface ApprovalResponseRequest {
  type: 'approval-response'
  requestId: string
  approved: boolean
  alwaysAllow?: boolean
}

export interface CancelRequest {
  type: 'cancel'
}

export type AgentDriverRequest =
  | PromptRequest
  | ApprovalResponseRequest
  | CancelRequest
