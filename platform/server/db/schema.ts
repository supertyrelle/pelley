import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// Projects - registered project directories
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
})

// Agents - custom agent definitions (built-ins are in-memory only)
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  command: text('command').notNull(),
  args: text('args').notNull(), // JSON array
  instanceType: text('instance_type').notNull(), // claude-code | opencode | kimi-code | llmcp | custom
  modelConfig: text('model_config'), // JSON object, nullable
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
})

// Sessions - terminal sessions (historical + active)
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  status: text('status').notNull(), // starting | running | stopped | error
  contextScope: text('context_scope').notNull(), // shared | isolated
  worktreePath: text('worktree_path'),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  endedAt: integer('ended_at', { mode: 'number' }),
})

// Layout state - panel layout persistence
export const layoutState = sqliteTable('layout_state', {
  id: text('id').primaryKey(), // always 'current'
  panels: text('panels').notNull(), // JSON array of PanelState
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
})

// Tasks - orchestrated agent tasks (bead + session + worktree)
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),           // bead ID
  title: text('title').notNull(),
  agentId: text('agent_id').notNull(),
  sessionId: text('session_id'),
  worktreePath: text('worktree_path'),
  status: text('status').notNull(),      // pending | running | completed | failed
  contextScope: text('context_scope').notNull(), // shared | isolated
  projectPath: text('project_path').notNull(),
  useWorktree: integer('use_worktree', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
})

// Settings - key-value store for app settings
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON value
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
})
