CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`agent_id` text NOT NULL,
	`session_id` text,
	`worktree_path` text,
	`status` text NOT NULL,
	`context_scope` text NOT NULL,
	`project_path` text NOT NULL,
	`use_worktree` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
