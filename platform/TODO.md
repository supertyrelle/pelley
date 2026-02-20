# EPIC: Fix terminal connection lifecycle and panel rendering issues

Terminals show "Disconnected" with a "Reconnect" button on all panels. Panel backgrounds flash intermittently. Drawing from parallel-code's architecture for solutions.

## Spike Findings

### Spike 1: Terminal Connection Lifecycle

- [x] SPIKE: Investigate why all terminals show "Disconnected"

**Findings:**

1. **Add CSS containment to terminal panels** -- Terminal panels lack rendering isolation. parallel-code uses `contain: strict` on terminal containers to prevent layout/paint thrashing between panels. Our `TerminalView.vue` container div has no containment.
   - source: app/components/TerminalView.vue:184
   - confidence: CONFIRMED
   - priority: P1
   - scope: TerminalView.vue

2. **Suppress overlay during initial connection window** -- `showOverlay` fires immediately because `status` starts as `'disconnected'` while `connectedAgentId` is set synchronously in `connectToAgent()`. The WebSocket `onopen` hasn't fired yet, so the overlay flashes "Disconnected" before the connection completes. Need a brief grace period or initial-connection state.
   - source: app/components/TerminalView.vue:174-176
   - confidence: CONFIRMED
   - priority: P0
   - scope: TerminalView.vue, useTerminal.ts

3. **Guard PTY spawn against node-pty load failure** -- `pty-manager.ts` uses `require('node-pty')` at spawn time (line 299). If the native module isn't built for the current platform, every WebSocket connection fails with a spawn error, which the client sees as instant disconnect. No user-facing diagnostic exists.
   - source: server/services/pty-manager.ts:298-299
   - confidence: CONFIRMED
   - priority: P0
   - scope: pty-manager.ts, terminal.ts (server route)

4. **Send structured error on PTY spawn failure** -- The terminal WebSocket route sends `{ type: 'error', message: '...' }` on spawn failure and then closes with code 4002, but `useTerminal.ts` `onclose` handler treats this as a disconnection and attempts reconnection. The error message from the server is logged but not surfaced to the user in the overlay.
   - source: server/routes/terminal.ts:101-108, app/composables/useTerminal.ts:113-121
   - confidence: CONFIRMED
   - priority: P1
   - scope: useTerminal.ts, TerminalView.vue

5. **Add session resume support using agent resumeArgs** -- `AgentConfig` already has a `resumeArgs` field (e.g., `['--resume']` for claude-code), but it is never used. parallel-code uses resume args on agent restart via a `generation` counter. Our platform should use `resumeArgs` when reconnecting to a session whose PTY exited, allowing agents like Claude Code to resume their last conversation.
   - source: shared/types/agent.ts:7
   - confidence: CONFIRMED
   - priority: P2
   - scope: agent-registry.ts, pty-manager.ts, task-manager.ts, TerminalView.vue

### Spike 2: Panel Background Flashing

- [x] SPIKE: Investigate intermittent panel background flashing

**Findings:**

6. **Debounce ResizeObserver fit calls** -- `TerminalView.vue` attaches a `ResizeObserver` that calls `fitAddon.fit()` + `terminal.resize()` on every observation. During panel width transitions (which use CSS `transition-[width] duration-300 ease-in-out`), the observer fires many times (~30fps), causing rapid xterm reflow and WS resize messages. parallel-code avoids this by not using CSS transitions for panel widths.
   - source: app/components/TerminalView.vue:80-90
   - confidence: CONFIRMED
   - priority: P1
   - scope: TerminalView.vue

7. **Prevent WebGL context loss/recreation flicker** -- WebGL addon's `onContextLoss` handler disposes the addon (line 98), which falls back to the canvas renderer mid-session. This causes a visible flash. parallel-code loads WebGL once and does not dispose on context loss.
   - source: app/components/TerminalView.vue:93-105
   - confidence: LIKELY
   - priority: P2
   - scope: TerminalView.vue

8. **Stabilize panel reactivity to prevent unnecessary re-renders** -- `useTilingLayout.ts` triggers full `panels.value = [...panels.value]` array replacement on every `resizePanel`, `setActivePanel`, and `persist()` call. This triggers Vue's reactivity to re-evaluate all panel-dependent computeds and watchers, including the `v-if="panel.agentId"` conditional in `index.vue` which can cause TerminalView remounts.
   - source: app/composables/useTilingLayout.ts:115, app/pages/index.vue:72-81
   - confidence: LIKELY
   - priority: P2
   - scope: useTilingLayout.ts, index.vue

### Spike 3: Status Display Improvements (inspired by parallel-code)

- [x] SPIKE: Investigate parallel-code's status and activity model

**Findings:**

9. **Add activity-based status (busy/idle/ready) alongside connection status** -- parallel-code tracks three orthogonal states: connection, activity (busy/waiting/ready via PTY output analysis), and git status. Our platform conflates connection state with agent state. Adding output-based idle detection (15s timeout like parallel-code) would let the UI show whether an agent is actively working vs idle.
   - source: parallel-code src/store/taskStatus.ts
   - confidence: CONFIRMED
   - priority: P3
   - scope: new composable or extension of useTerminal.ts, PanelHeader.vue

10. **Add prompt/question detection to prevent stale "busy" indicators** -- parallel-code detects shell prompts (`$`, `%`, `#`) and agent question patterns (`[Y/n]`, `trust`, `allow`) in PTY output to determine if the agent is waiting for input. This enables auto-send features and accurate status display.
    - source: parallel-code src/store/taskStatus.ts
    - confidence: CONFIRMED
    - priority: P3
    - scope: new server-side or client-side output analysis

### Spike 4: Connection Resilience

- [x] SPIKE: Investigate reconnection and session persistence

**Findings:**

11. **Persist PTY sessions across page reloads** -- Currently, `useTerminal()` creates fresh state on every component mount. The `sessionId` from the server is stored in a ref but lost on page reload. The `TailBuffer` replay in `terminal.ts` (server) works for reconnect-by-sessionId, but the client never persists sessionId to survive reloads. parallel-code's `persistence.ts` store module handles this.
    - source: app/composables/useTerminal.ts:27-28, server/routes/terminal.ts:171-175
    - confidence: CONFIRMED
    - priority: P2
    - scope: useTerminal.ts, useTilingLayout.ts (persist sessionId alongside panel state)

12. **Kill orphaned PTY sessions on server restart** -- `PtyManager.killAll()` exists but is never called on server shutdown. `TaskManager.init()` marks stale running tasks as failed on restart, but the corresponding PTY processes from a previous server instance are already dead (process memory is gone). The real issue is that after a dev server restart (HMR), the client WebSocket reconnects to a server that has no record of the old sessionId, causing immediate disconnect.
    - source: server/services/pty-manager.ts:369-375, server/services/task-manager.ts:62-73
    - confidence: CONFIRMED
    - priority: P2
    - scope: pty-manager.ts, terminal.ts, useTerminal.ts

13. **Handle server restart gracefully on client** -- When the dev server restarts (HMR/rebuild), all WebSocket connections drop. The client auto-reconnects (3 attempts with exponential backoff), but reconnects to a server that has no PTY sessions. The reconnect sends `?reconnect=<old-session-id>` which fails because the session doesn't exist. Instead, the client should detect server restart and offer to re-spawn the agent.
    - source: app/composables/useTerminal.ts:128-156, server/routes/terminal.ts:59-72
    - confidence: CONFIRMED
    - priority: P1
    - scope: useTerminal.ts, TerminalView.vue

## Priority Order

1. P0: Suppress overlay during initial connection window (#2)
2. P0: Guard PTY spawn against node-pty load failure (#3)
3. P1: Handle server restart gracefully on client (#13)
4. P1: Send structured error on PTY spawn failure (#4)
5. P1: Add CSS containment to terminal panels (#1)
6. P1: Debounce ResizeObserver fit calls (#6)
7. P2: Persist PTY sessions across page reloads (#11)
8. P2: Kill orphaned PTY sessions / handle dev restart (#12)
9. P2: Add session resume support using agent resumeArgs (#5)
10. P2: Prevent WebGL context loss/recreation flicker (#7)
11. P2: Stabilize panel reactivity (#8)
12. P3: Add activity-based status (#9)
13. P3: Add prompt/question detection (#10)

## Task Dependencies

<!-- depends-on relationships -->
<!-- #4 depends on #3 (spawn failure must be detected before it can be surfaced) -->
<!-- #5 depends on #13 (resume only matters after graceful restart handling) -->
<!-- #10 depends on #9 (question detection is a refinement of activity tracking) -->
<!-- #11 depends on #13 (persisting sessionId only helps if restart handling works) -->

## Clean Areas

- **Server-side PTY batching and flow control** -- Well-implemented with 8ms batching interval, 64KB batch threshold, and 256KB/32KB high/low water marks. Matches parallel-code's approach.
- **TailBuffer for reconnect replay** -- 5000-line circular buffer provides good reconnect experience when the session is still alive.
- **Agent registry and model config** -- Clean separation of concerns, env var mapping, and custom agent persistence.
- **Panel resizing and drag mechanics** -- TilingLayout drag/resize is solid with proper clamping and cleanup.

---

# EPIC: Platform UX gaps -- beads management, shortcuts, branding, terminal feedback

User-reported issues: (1) beads tasks not visible or manageable in the UI, (2) keyboard shortcuts like Ctrl+O don't work when terminal is focused, (3) sidebar says "Platform" instead of "pelley", (4) long-running commands (like blossom) make the terminal appear paused with no feedback.

## Spike Findings

### Spike 1: Beads Management UI

- [x] SPIKE: Investigate beads visibility and management in the UI

**Findings:**

The backend has complete beads CRUD -- list (`GET /api/beads`), show (`GET /api/beads/:id`), create (`POST /api/beads`), update (`PATCH /api/beads/:id`), close (`POST /api/beads/:id/close`), children (`GET /api/beads/:id/children`), stats (`GET /api/beads/stats`), ready (`GET /api/beads/ready`), deps (`POST /api/beads/:id/dep`), and epic status (`GET /api/beads/epics/status`). Real-time events are pushed via WebSocket on `/beads-sync`.

The frontend only consumes `useBeadsSync()` for aggregate stats (3 numbers: open, active, closed) shown in the sidebar's Context section and InfoBar. There is zero UI for browsing individual beads, viewing bead details, assigning beads, changing status, creating beads, or managing epics.

The sidebar's "Tasks" section shows platform Tasks (agent execution sessions from `useTaskManager`), not beads. These are completely different concepts -- Tasks are terminal sessions tied to agents, while Beads are backlog items (issues, epics, bugs, spikes).

14. **Add beads list view to sidebar** -- Replace or supplement the stats-only widget in the Context section with a scrollable list of individual beads showing title, status, priority, and type. Currently only 3 aggregate numbers are shown (open/active/closed) via `useBeadsSync()` at AppSidebar.vue:407-432.
    - source: app/components/AppSidebar.vue:406-433
    - confidence: CONFIRMED
    - priority: P1
    - scope: AppSidebar.vue, new useBeads.ts composable

15. **Create beads detail panel or modal** -- No way to view a bead's full details (description, dependencies, assignee, labels, children). The `Bead` type (shared/types/bead.ts) has all these fields. The API supports `GET /api/beads/:id` and `GET /api/beads/:id/children`. Need a detail view accessible from the beads list.
    - source: shared/types/bead.ts:1-16, server/api/beads/[id].get.ts
    - confidence: CONFIRMED
    - priority: P1
    - scope: new BeadDetail.vue component

16. **Add bead status/assignee management actions** -- `PATCH /api/beads/:id` accepts title, priority, description, status, and assignee updates. `POST /api/beads/:id/close` closes beads. None of these are exposed in the UI. Users should be able to change status, assign beads to agents, and close beads from the detail view.
    - source: server/api/beads/[id].patch.ts, server/api/beads/[id]/close.post.ts
    - confidence: CONFIRMED
    - priority: P1
    - scope: BeadDetail.vue (inline editing or action buttons)

17. **Add bead creation from UI** -- `POST /api/beads` supports creating beads with title, type, priority, parent, and description. No UI form exists. Users should be able to create beads without going through the CLI.
    - source: server/api/beads/index.post.ts
    - confidence: CONFIRMED
    - priority: P2
    - scope: new BeadCreateForm.vue or modal

18. **Add useBeads composable for REST-based bead management** -- `useBeadsSync` only handles WebSocket stats. Need a REST-based composable (similar to `useTaskManager`) that wraps the beads API endpoints for list/show/create/update/close operations with reactive local state.
    - source: app/composables/useBeadsSync.ts (WebSocket-only, no REST)
    - confidence: CONFIRMED
    - priority: P0
    - scope: new app/composables/useBeads.ts

19. **Show epic progress in sidebar** -- `GET /api/beads/epics/status` returns epic completion percentage, child counts, and close-eligibility. This data is available but not surfaced anywhere in the UI. Epics should show as collapsible groups with progress bars.
    - source: server/api/beads/epics/status.get.ts, shared/types/bead.ts:37-45
    - confidence: CONFIRMED
    - priority: P2
    - scope: AppSidebar.vue or dedicated BeadsList.vue

20. **Distinguish beads from tasks in sidebar** -- The sidebar "Tasks" section shows agent execution tasks (useTaskManager). Users expect to see their beads (backlog items) here too. Either merge them with clear visual distinction, or add a dedicated "Backlog" section for beads separate from "Tasks".
    - source: app/components/AppSidebar.vue:240-334 (Tasks section)
    - confidence: CONFIRMED
    - priority: P1
    - scope: AppSidebar.vue

### Spike 2: Keyboard Shortcut System

- [x] SPIKE: Investigate keyboard shortcut gaps and Ctrl+O not working

**Findings:**

The shortcut system in `useKeyboardShortcuts.ts` works correctly for its design constraints, but those constraints are too restrictive. When a terminal (xterm) is focused, only `Ctrl+Shift` combos are intercepted (line 117: `if (inTerminal && !isCtrlShiftCombo(combo)) continue`). All other key combos (including `Ctrl+O`, `Ctrl+K`, `Alt+...`) pass through to the terminal.

This is intentional to avoid interfering with terminal applications, but it means platform-level shortcuts are effectively invisible when the terminal has focus -- which is most of the time.

21. **Add configurable shortcut passthrough/intercept modes** -- The current binary rule (only Ctrl+Shift passes through to platform when terminal focused) is too restrictive. Users need a way to define which shortcuts the platform intercepts vs passes to the terminal. Options: (a) a configurable allowlist of platform-level shortcuts that always intercept, (b) a "leader key" pattern (press Escape first, then the shortcut), or (c) a toggle mode where a key switches between "terminal mode" and "platform mode".
    - source: app/composables/useKeyboardShortcuts.ts:116-117
    - confidence: CONFIRMED
    - priority: P1
    - scope: useKeyboardShortcuts.ts, GeneralTab.vue (settings)

22. **Add Escape-based command palette** -- Rather than fighting terminal keybinding conflicts, add a command palette (like VS Code's Ctrl+Shift+P) accessible via a universal shortcut. This sidesteps the terminal passthrough problem entirely. The palette would list all registered shortcuts plus additional commands (beads management, panel operations, settings).
    - source: app/composables/useKeyboardShortcuts.ts (bindings registry already exists)
    - confidence: CONFIRMED
    - priority: P1
    - scope: new CommandPalette.vue, index.vue (registration)

23. **Register terminal-specific shortcuts for Claude Code** -- Claude Code uses Ctrl+O to show thinking, Ctrl+C to cancel, etc. These are terminal-native keybindings that xterm passes through correctly. The issue is that users expect Ctrl+O to work as a "platform shortcut" when it's actually a terminal passthrough. The platform needs documentation or a visual indicator showing which shortcuts are terminal-native vs platform-level.
    - source: app/composables/useKeyboardShortcuts.ts:72-80 (isTerminalFocused, isCtrlShiftCombo)
    - confidence: CONFIRMED
    - priority: P2
    - scope: ShortcutHelp.vue (add terminal-native shortcuts section), GeneralTab.vue

24. **Add shortcut conflict detection** -- No mechanism to detect when a registered platform shortcut conflicts with a terminal application's keybinding. If a user registers `Ctrl+K` as a platform shortcut, it would be intercepted only when terminal is not focused -- leading to inconsistent behavior.
    - source: app/composables/useKeyboardShortcuts.ts:109-126 (handleKeyDown)
    - confidence: CONFIRMED
    - priority: P3
    - scope: useKeyboardShortcuts.ts

### Spike 3: Platform Branding

- [x] SPIKE: Investigate "Platform" name references that should be "pelley"

**Findings:**

25. **Rename "Platform" to "pelley" in sidebar header** -- AppSidebar.vue:176 hardcodes "Platform" as the sidebar title. Should be "pelley".
    - source: app/components/AppSidebar.vue:176
    - confidence: CONFIRMED
    - priority: P0
    - scope: AppSidebar.vue (1 line change)

26. **Rename "Platform" to "pelley" in page header** -- index.vue:51 hardcodes "Platform" in the top bar h1 element. Should be "pelley".
    - source: app/pages/index.vue:51
    - confidence: CONFIRMED
    - priority: P0
    - scope: index.vue (1 line change)

27. **Rename "Platform" to "pelley" in plugins breadcrumb** -- plugins.vue:11 uses "Platform" as the breadcrumb link text back to the home page. Should be "pelley".
    - source: app/pages/plugins.vue:11
    - confidence: CONFIRMED
    - priority: P0
    - scope: plugins.vue (1 line change)

### Spike 4: Terminal UX During Long Operations

- [x] SPIKE: Investigate terminal "paused" appearance during long-running commands

**Findings:**

The terminal itself doesn't pause -- the issue is that during long-running agent commands (like blossom), the agent is spawning subagents and processing internally with no visible terminal output for extended periods. The terminal shows a connected status with no output, which looks like it froze.

28. **Add agent activity indicator to panel header** -- PanelHeader.vue only shows connection status (green/yellow/red/gray dot). When the agent is connected but producing no output (e.g., during blossom's internal processing), the user sees a green dot and a blank terminal -- indistinguishable from "frozen". Need an activity indicator that shows whether data has been received recently (e.g., a pulsing indicator when output was received in the last 5 seconds, steady when idle for >15 seconds).
    - source: app/components/PanelHeader.vue:21-29 (statusColor computed)
    - confidence: CONFIRMED
    - priority: P1
    - scope: PanelHeader.vue, useTerminal.ts (add lastOutputAt timestamp)

29. **Add idle/busy detection based on PTY output** -- This is the client-side equivalent of spike finding #9 (activity-based status). Track the timestamp of the last received data in `useTerminal.ts` and expose a reactive `isIdle` computed (true when no output for >15 seconds). The panel header and info bar can use this to show whether the agent is actively processing.
    - source: app/composables/useTerminal.ts:84-122 (onmessage handler)
    - confidence: CONFIRMED
    - priority: P1
    - scope: useTerminal.ts, PanelHeader.vue
    <!-- depends on: #28 (activity indicator displays the idle/busy state) -->

30. **Add output scroll position indicator** -- When the terminal has extensive output and the user scrolls up, new output continues arriving at the bottom. There's no indicator that new content is available below the viewport. Adding a "scroll to bottom" button (like chat UIs) when the user has scrolled up would help users know the agent is still producing output.
    - source: app/components/TerminalView.vue (no scroll position tracking exists)
    - confidence: CONFIRMED
    - priority: P2
    - scope: TerminalView.vue

## Priority Order

1. P0: Rename "Platform" to "pelley" in sidebar header (#25)
2. P0: Rename "Platform" to "pelley" in page header (#26)
3. P0: Rename "Platform" to "pelley" in plugins breadcrumb (#27)
4. P0: Add useBeads composable for REST-based bead management (#18)
5. P1: Add beads list view to sidebar (#14)
6. P1: Create beads detail panel or modal (#15)
7. P1: Add bead status/assignee management actions (#16)
8. P1: Distinguish beads from tasks in sidebar (#20)
9. P1: Add configurable shortcut passthrough/intercept modes (#21)
10. P1: Add Escape-based command palette (#22)
11. P1: Add agent activity indicator to panel header (#28)
12. P1: Add idle/busy detection based on PTY output (#29)
13. P2: Add bead creation from UI (#17)
14. P2: Show epic progress in sidebar (#19)
15. P2: Register terminal-specific shortcuts for Claude Code (#23)
16. P2: Add output scroll position indicator (#30)
17. P3: Add shortcut conflict detection (#24)

## Task Dependencies

<!-- depends-on relationships -->
<!-- #14 depends on #18 (list view needs useBeads composable for REST data) -->
<!-- #15 depends on #18 (detail panel needs useBeads composable) -->
<!-- #16 depends on #15 (management actions live in detail panel) -->
<!-- #17 depends on #18 (creation form needs useBeads composable) -->
<!-- #19 depends on #14 (epic progress shown within beads list) -->
<!-- #20 depends on #14 (distinguishing requires beads list to exist) -->
<!-- #29 depends on #28 (idle detection feeds the activity indicator) -->

## Clean Areas

- **Backend beads API** -- Complete and well-structured. All CRUD operations plus stats, ready, children, deps, epic status, and sync are implemented. Real-time WebSocket events work. No backend work needed for beads management.
- **WebSocket beads sync** -- `useBeadsSync.ts` handles real-time stats updates correctly with auto-reconnect and exponential backoff.
- **Shortcut parsing and matching** -- `parseKeyCombo` and `eventMatchesCombo` handle all modifier keys correctly including Mac Cmd-as-Ctrl mapping. The parser itself is solid.
- **Terminal view connection lifecycle** -- `useTerminal.ts` handles connect, reconnect, disconnect, session expiry, and error states correctly. (Issues from the previous epic were addressed.)
- **Settings modal structure** -- Already has tabs for Providers, Agents, Plugins, and General. Easy to add a Shortcuts or Beads tab.

---

# EPIC: Pink theme with design tokens -- decouple color palette from color scheme

Create a pink pelley theme, decouple the color palette from the color scheme so pelley has dark and light mode design tokens as a color palette, and make all components compatible with the design tokens.

## Spike Findings

### Spike 1: Nuxt UI Theme Configuration

- [x] SPIKE: How to set pink as primary, configure neutral, register custom colors via app.config.ts and main.css

**Findings:**

Nuxt UI v4 uses `app.config.ts` for runtime color aliases and `main.css` for CSS variable overrides. Currently:
- No `app.config.ts` exists -- Nuxt UI defaults to primary=green, neutral=gray
- `main.css` only has `@import "tailwindcss"; @import "@nuxt/ui";` (no custom tokens)
- 7 components use `color="primary"` for Nuxt UI components (buttons, avatars, badges) -- these will auto-switch to pink once primary is configured
- Tailwind's built-in `pink` color scale (pink-50 through pink-950) is available out of the box

31. **Create app.config.ts with pink primary and custom neutral** -- No `app.config.ts` exists. Create one setting `primary: 'pink'` and `neutral: 'slate'` (or a custom pink-tinted neutral). This single file makes all Nuxt UI components (`color="primary"`) use pink. Also configures secondary color for accent variety.
    - source: nuxt.config.ts (no app.config.ts), app/components/*.vue (7 `color="primary"` usages)
    - confidence: CONFIRMED
    - priority: P0
    - scope: new app.config.ts (1 file)

32. **Customize Nuxt UI CSS semantic variables for pink theme** -- Override `--ui-primary`, `--ui-bg`, `--ui-border`, `--ui-text` and their variants in `main.css` using `:root` / `.dark` selectors. This establishes the design token layer that components will consume.
    - source: app/assets/css/main.css (currently 2 lines), Nuxt UI docs show the pattern
    - confidence: CONFIRMED
    - priority: P0
    - scope: app/assets/css/main.css

### Spike 2: Design Token Architecture

- [x] SPIKE: Define CSS custom property system for surfaces, borders, text, accents in light/dark modes

**Findings:**

Nuxt UI v4 already provides a complete CSS variable design token system. The tokens exist but our components bypass them entirely:

**Available Nuxt UI tokens (auto-provided):**
- Backgrounds: `--ui-bg`, `--ui-bg-muted`, `--ui-bg-elevated`, `--ui-bg-accented`, `--ui-bg-inverted`
- Borders: `--ui-border`, `--ui-border-muted`, `--ui-border-accented`, `--ui-border-inverted`
- Text: `--ui-text`, `--ui-text-dimmed`, `--ui-text-muted`, `--ui-text-toned`, `--ui-text-highlighted`, `--ui-text-inverted`
- Primary: `--ui-primary` (maps to the primary color shade for current light/dark mode)

**What our components use instead:**
- `bg-gray-50 dark:bg-gray-900` instead of Nuxt UI's `bg-(--ui-bg)` or equivalent
- `border-gray-200 dark:border-gray-700` instead of `border-(--ui-border)`
- `text-gray-700 dark:text-gray-200` instead of `text-(--ui-text)`

33. **Define custom pink-tinted neutral palette** -- Create a custom `pelley` color scale (50-950) in `main.css` using `@theme static { }` that blends pink warmth into neutral grays. This gives the app a cohesive pink identity beyond just the primary color. Example: `--color-pelley-50: #fdf2f4;` through `--color-pelley-950: #1a0a0e;`.
    - source: app/assets/css/main.css, Nuxt UI docs on `@theme static` custom colors
    - confidence: CONFIRMED
    - priority: P1
    - scope: app/assets/css/main.css

34. **Map Nuxt UI semantic tokens to pink-tinted palette** -- Override `:root` and `.dark` CSS variable blocks to map `--ui-bg`, `--ui-border`, `--ui-text` families to the custom pelley neutral palette. Light mode: `--ui-bg: var(--color-pelley-50)`, dark mode: `--ui-bg: var(--color-pelley-950)`, etc.
    - source: app/assets/css/main.css
    - confidence: CONFIRMED
    - priority: P1
    - scope: app/assets/css/main.css

### Spike 3: Component Color Audit

- [x] SPIKE: Survey all ~20 components for hardcoded Tailwind color classes, categorize by token type

**Findings:**

Audited all 22 Vue components + 2 plugin components. Found ~200+ hardcoded color class occurrences. Categorized by token type:

**Surface colors (bg-gray-* / bg-white) -- 18 components affected:**
- `bg-gray-50 dark:bg-gray-900`: AppSidebar, InfoBar, AgentPicker, PanelHeader (sidebar, footer, empty panels, headers)
- `bg-white dark:bg-gray-800`: AppSidebar forms/detail panels, AgentPicker cards, CommandPalette kbd
- `bg-white dark:bg-gray-900`: index.vue top bar, plugins.vue top bar, CommandPalette
- `bg-gray-100 dark:bg-gray-800`: DiffViewer hover, PluginBrowser icon bg, OracleChat assistant msgs
- `bg-gray-100 dark:bg-gray-700`: ShortcutHelp kbd, GeneralTab kbd, CommandPalette kbd
- `bg-gray-200 dark:bg-gray-700`: ProvidersTab progress track, filter active state
- `bg-gray-800`: TerminalView overlay panel
- `bg-gray-700/80`: TerminalView scroll-to-bottom button

**Border colors -- every component uses `border-gray-200 dark:border-gray-700`**
- Some variants: `border-gray-300 dark:border-gray-600` (inputs, kbd, dashed borders)

**Text colors -- 20+ components:**
- `text-gray-900 dark:text-white` (headings) -- maps to `--ui-text-highlighted`
- `text-gray-800 dark:text-gray-200` (emphasized) -- maps to `--ui-text-highlighted`
- `text-gray-700 dark:text-gray-200` (body) -- maps to `--ui-text`
- `text-gray-600 dark:text-gray-400` (descriptions) -- maps to `--ui-text-toned`
- `text-gray-500 dark:text-gray-400` (labels, secondary) -- maps to `--ui-text-muted`
- `text-gray-400 dark:text-gray-500` (dimmed, placeholders) -- maps to `--ui-text-dimmed`

**Hover states -- 12 components:**
- `hover:bg-gray-200/60 dark:hover:bg-gray-700/60` (sidebar items)
- `hover:bg-gray-100 dark:hover:bg-gray-800` (file lists, settings rows)
- `hover:bg-gray-50 dark:hover:bg-gray-800` (command palette)

**Accent/status colors (should NOT be migrated -- these are semantic):**
- green-500 (connected, enabled, running, diff additions)
- yellow-500 (connecting, pending, in-progress)
- red-500 (error, failed, blocked, diff deletions)
- blue-500 (open beads, active panel ring, diff modified)
- orange-500 (isolated sessions, P1 priority)
- primary-500 (Oracle icon, user messages, progress bars -- already uses design token)

35. **Migrate AppSidebar.vue from hardcoded colors to design tokens** -- Largest component (810 lines). Contains ~40 hardcoded color classes for surfaces, borders, text, hover states, and form elements. This is the highest-impact single migration.
    - source: app/components/AppSidebar.vue (entire file)
    - confidence: CONFIRMED
    - priority: P1
    - scope: AppSidebar.vue (~40 class replacements)

36. **Migrate index.vue and plugins.vue top bars** -- Both pages have hardcoded `bg-white dark:bg-gray-900` and `border-gray-200 dark:border-gray-700` in their header elements.
    - source: app/pages/index.vue:52, app/pages/plugins.vue:5
    - confidence: CONFIRMED
    - priority: P1
    - scope: index.vue, plugins.vue (~6 class replacements)

37. **Migrate TilingLayout.vue and PanelHeader.vue** -- Panel border colors, panel header backgrounds, resize handle colors, active panel ring color.
    - source: app/components/TilingLayout.vue:89-122, app/components/PanelHeader.vue:44
    - confidence: CONFIRMED
    - priority: P1
    - scope: TilingLayout.vue, PanelHeader.vue (~10 class replacements)

38. **Migrate InfoBar.vue** -- Footer bar with hardcoded surface, border, and text colors.
    - source: app/components/InfoBar.vue:79
    - confidence: CONFIRMED
    - priority: P1
    - scope: InfoBar.vue (~8 class replacements)

39. **Migrate AgentPicker.vue** -- Empty panel state and agent card surfaces, borders, hover states.
    - source: app/components/AgentPicker.vue:24,51-54
    - confidence: CONFIRMED
    - priority: P1
    - scope: AgentPicker.vue (~10 class replacements)

40. **Migrate CommandPalette.vue and ShortcutHelp.vue** -- Modal overlays, search input, command list items, kbd elements.
    - source: app/components/CommandPalette.vue:118-193, app/components/ShortcutHelp.vue:67-158
    - confidence: CONFIRMED
    - priority: P2
    - scope: CommandPalette.vue, ShortcutHelp.vue (~25 class replacements)

41. **Migrate TerminalView.vue overlay and scroll button** -- Overlay uses `bg-black/60` and `bg-gray-800` which should use elevated surface tokens. Scroll-to-bottom button uses `bg-gray-700/80`.
    - source: app/components/TerminalView.vue:268-317
    - confidence: CONFIRMED
    - priority: P2
    - scope: TerminalView.vue (~5 class replacements)

42. **Migrate DiffViewer.vue and DiffViewerModal.vue** -- File list hover states, file header backgrounds, fallback diff line colors.
    - source: app/components/DiffViewer.vue:170-295, app/components/DiffViewerModal.vue
    - confidence: CONFIRMED
    - priority: P2
    - scope: DiffViewer.vue, DiffViewerModal.vue (~12 class replacements)

43. **Migrate SettingsModal.vue and settings tabs** -- GeneralTab, ProvidersTab, AgentsTab, PluginsTab all have hardcoded text, border, and surface colors in forms, cards, and code snippets.
    - source: app/components/settings/*.vue, app/components/SettingsModal.vue
    - confidence: CONFIRMED
    - priority: P2
    - scope: 5 files (~30 class replacements total)

44. **Migrate PluginBrowser.vue and PluginPanel.vue** -- Plugin cards, icon backgrounds, empty states, error states.
    - source: app/components/PluginBrowser.vue, app/components/PluginPanel.vue
    - confidence: CONFIRMED
    - priority: P2
    - scope: PluginBrowser.vue, PluginPanel.vue (~15 class replacements)

45. **Migrate OracleChat.vue and OracleSettings.vue** -- Chat bubbles, header borders, input areas, settings popover.
    - source: plugins/oracle/components/OracleChat.vue, plugins/oracle/components/OracleSettings.vue
    - confidence: CONFIRMED
    - priority: P2
    - scope: OracleChat.vue, OracleSettings.vue (~10 class replacements)

46. **Migrate NotificationToast.vue** -- Minimal changes needed as it uses Nuxt UI's UAlert which respects design tokens. Only verify no hardcoded colors.
    - source: app/components/NotificationToast.vue
    - confidence: CONFIRMED
    - priority: P3
    - scope: NotificationToast.vue (verify only)

### Spike 4: Terminal Theme Integration

- [x] SPIKE: How xterm themes should relate to app-wide design tokens

**Findings:**

Terminal themes (`useTheme.ts`) are completely independent from app theming:
- 6 hardcoded presets: default, monokai, solarized-dark, solarized-light, dracula, nord
- `TerminalThemePreset` type in `shared/types/theme.ts` is a string union of these 6 names
- `TerminalView.vue` applies theme via `xterm.options.theme = getTerminalTheme()` and inline style `backgroundColor`
- The GeneralTab has a color mode selector (light/dark/system) but no terminal theme selector
- Terminal themes are stored in localStorage with key `platform:terminal-theme`

47. **Add pelley-pink terminal theme preset** -- Create a pink-tinted terminal theme that matches the app's design tokens. Dark variant: warm dark pink-gray background (#1a1017), pink-tinted foreground, pink cursor. Light variant: warm light pink background (#fdf2f4).
    - source: app/composables/useTheme.ts:6-138, shared/types/theme.ts
    - confidence: CONFIRMED
    - priority: P1
    - scope: useTheme.ts (add theme object), shared/types/theme.ts (add type)

48. **Add auto-follow mode for terminal theme** -- When color mode changes (light/dark), auto-switch terminal theme to the matching pelley variant. Add a "System" option that follows the app color scheme instead of using a fixed preset.
    - source: app/composables/useTheme.ts:153-178, app/components/TerminalView.vue:37-41 (watch)
    - confidence: CONFIRMED
    - priority: P2
    - scope: useTheme.ts, TerminalView.vue

49. **Add terminal theme selector to GeneralTab** -- The settings General tab has color mode but no terminal theme picker. Add a dropdown or visual grid showing available terminal theme presets with a live preview swatch.
    - source: app/components/settings/GeneralTab.vue:30-54
    - confidence: CONFIRMED
    - priority: P2
    - scope: GeneralTab.vue

### Spike 5: Color Palette/Scheme Separation

- [x] SPIKE: Architecture for decoupling palette from scheme

**Findings:**

Nuxt UI v4 already implements a 3-layer color architecture, but our codebase bypasses it entirely:

**Layer 1: Color Palette** (raw color scales)
- Tailwind provides built-in scales: gray, slate, zinc, pink, blue, etc.
- Custom scales can be added via `@theme static { --color-<name>-<shade>: <hex>; }`
- `app.config.ts` maps semantic names to palette names: `primary: 'pink'`, `neutral: 'slate'`

**Layer 2: Color Scheme** (mode-aware semantic tokens)
- Nuxt UI generates CSS variables: `--ui-color-primary-50` through `--ui-color-primary-950`
- Semantic tokens in `:root` and `.dark` map to appropriate shades per mode
- Example: `--ui-primary: var(--ui-color-primary-500)` in light, `var(--ui-color-primary-400)` in dark

**Layer 3: Component consumption**
- Components should use `bg-(--ui-bg)`, `text-(--ui-text)`, `border-(--ui-border)` etc.
- Or use Nuxt UI's Tailwind utilities that reference these tokens

**Current state: Layer 1 and 2 are unconfigured, Layer 3 is hardcoded.**

50. **Define color palette layer in main.css** -- Register the pelley color palette (pink-tinted neutrals) using `@theme static { }` in main.css. Define 11 shades (50-950) for the custom neutral and confirm pink is available as primary.
    - source: app/assets/css/main.css
    - confidence: CONFIRMED
    - priority: P0
    - scope: app/assets/css/main.css
    <!-- NOTE: This overlaps with #33 -- same file, same section. Consolidate into one task. -->

51. **Define color scheme layer with mode-aware token overrides** -- In main.css, override Nuxt UI's `:root` and `.dark` blocks to map semantic tokens (bg, border, text families) to the custom pelley palette. This is the scheme layer that makes tokens mode-aware.
    - source: app/assets/css/main.css
    - confidence: CONFIRMED
    - priority: P0
    - scope: app/assets/css/main.css
    <!-- NOTE: This overlaps with #34 -- same file, same section. Consolidate into one task. -->

52. **Create Tailwind utility classes or conventions for token consumption** -- Document and establish the mapping from old hardcoded patterns to new token-based patterns. E.g., `bg-gray-50 dark:bg-gray-900` becomes `bg-(--ui-bg)`. Create a migration guide or cheat sheet for the component migrations.
    - source: N/A (new documentation)
    - confidence: CONFIRMED
    - priority: P1
    - scope: documentation or inline comments

## Consolidation Notes

**Dedup:** Tasks #33/#50 and #34/#51 are duplicates (same work in same file). Consolidated below.

## Priority Order

1. P0: Create app.config.ts with pink primary and custom neutral (#31)
2. P0: Define color palette + scheme tokens in main.css (#32, #33/50, #34/51 consolidated)
3. P1: Add pelley-pink terminal theme preset (#47)
4. P1: Create migration guide for token consumption patterns (#52)
5. P1: Migrate AppSidebar.vue (#35)
6. P1: Migrate index.vue and plugins.vue top bars (#36)
7. P1: Migrate TilingLayout.vue and PanelHeader.vue (#37)
8. P1: Migrate InfoBar.vue (#38)
9. P1: Migrate AgentPicker.vue (#39)
10. P2: Migrate CommandPalette.vue and ShortcutHelp.vue (#40)
11. P2: Migrate TerminalView.vue overlay (#41)
12. P2: Migrate DiffViewer.vue (#42)
13. P2: Migrate settings tabs (#43)
14. P2: Migrate PluginBrowser.vue and PluginPanel.vue (#44)
15. P2: Migrate OracleChat.vue and OracleSettings.vue (#45)
16. P2: Add auto-follow mode for terminal theme (#48)
17. P2: Add terminal theme selector to GeneralTab (#49)
18. P3: Verify NotificationToast.vue (#46)

## Task Dependencies

<!-- depends-on relationships -->
<!-- #32 depends on #31 (CSS tokens reference the palette configured in app.config.ts) -->
<!-- #35-#46 all depend on #32 (components can only migrate after design tokens are defined) -->
<!-- #52 depends on #32 (migration guide documents the token patterns established in #32) -->
<!-- #35-#46 depend on #52 (migration guide provides the patterns for all component migrations) -->
<!-- #47 depends on #32 (terminal theme colors should match the palette defined in main.css) -->
<!-- #48 depends on #47 (auto-follow needs the pelley terminal theme to exist) -->
<!-- #49 depends on #47 (selector needs the pelley theme in the preset list) -->

## Clean Areas

- **Nuxt UI component props** -- All 7 usages of `color="primary"` will auto-switch to pink once app.config.ts is created. No component changes needed for these.
- **Status/accent colors** -- green (connected), yellow (pending), red (error), blue (open/active), orange (isolated) are semantic status indicators. These should remain as-is, not mapped to design tokens.
- **Nuxt UI built-in component styling** -- UCard, UBadge, UButton, UModal, UInput, USelect, USwitch, UAlert, UTabs, UTooltip, UAvatar all respect the primary/neutral color config automatically. No migration needed for Nuxt UI component internals.
- **Server code** -- No color/theme concerns on the backend.
- **Layout structure** -- AppLayout.vue and default.vue layout are minimal wrappers with no hardcoded colors.

---

# EPIC: Session persistence, permission-skip settings, and pre-launch agent config

Enable CLI session continuation (--continue/--resume), permission-skip mode (--dangerously-skip-permissions/--yolo), and pre-launch configuration UI so users can toggle these settings before instantiating a CLI agent.

## Spike Findings

### Spike 1: Session Persistence Flags Per CLI

- [x] SPIKE: Investigate session persistence flags for each supported CLI

**Findings:**

| CLI | Continue Flag | Resume Flag | Session Storage |
|-----|--------------|-------------|-----------------|
| Claude Code | `--continue` / `-c` | `--resume <id-or-name>` / `-r` | `~/.claude/projects/` JSONL |
| Kimi Code | `--continue` / `-C` | `--session <id>` / `-S` | Internal session store |
| OpenCode | `--continue` / `-c` | `--session <id>` / `-s` | Internal session store |
| llmcp | None | None | N/A |

1. **Add launchOptions to AgentConfig type and agent registry** -- `AgentConfig` (shared/types/agent.ts) has no mechanism for per-launch toggleable flags. The `args` field is static. Need a `launchOptions` field with `sessionContinue` and `permissionSkip` booleans, plus a mapping from instanceType to CLI flags.
   - source: shared/types/agent.ts:1-14, server/services/agent-registry.ts:13-43
   - confidence: CONFIRMED
   - priority: P1
   - scope: shared/types/agent.ts, server/services/agent-registry.ts

2. **Wire session continue to use --continue on fresh spawn** -- Platform conflates PTY reconnect (WebSocket reconnects to alive PTY) with CLI session continuation (new PTY with --continue flag). When a PTY dies, the Restart button spawns a fresh session with no --continue. Need to pass --continue when sessionContinue is enabled.
   - source: app/components/TerminalView.vue:279-304 (Restart button), server/routes/terminal.ts:84-121 (resume path)
   - confidence: CONFIRMED
   - priority: P1
   - scope: TerminalView.vue, terminal.ts, useTerminal.ts

### Spike 2: Permission-Skip / YOLO Mode Flags

- [x] SPIKE: Investigate permission-skip flags for each CLI

**Findings:**

| CLI | Permission-Skip Flag | Config Equivalent |
|-----|---------------------|-------------------|
| Claude Code | `--dangerously-skip-permissions` | `skipDangerousModePermissionPrompt: true` |
| Kimi Code | `--yolo` / `--yes` / `-y` / `--auto-approve` | `default_yolo = true` |
| OpenCode | None documented | N/A |
| llmcp | N/A | N/A |

3. **Add launch options to spawn pipeline** -- terminal.ts WebSocket handler spawns PTY with `config.args` directly. Need to accept launch option query params and build final args by merging base args with flag-derived args per instanceType.
   - source: server/routes/terminal.ts:150-154 (spawn with static args)
   - confidence: CONFIRMED
   - priority: P1
   - scope: server/routes/terminal.ts

### Spike 3: Pre-Launch Agent Configuration UI

- [x] SPIKE: Investigate pre-launch configuration UI

**Findings:**

4. **Add launch options UI to AgentPicker before spawn** -- Zero interstitial step between agent selection and PTY spawn. AgentPicker emits `select(agentId)` -> index.vue sets panel agentId -> TerminalView spawns immediately. Need a brief "Launch options" step with toggles for session continue and permission skip.
   - source: app/components/AgentPicker.vue:4-6 (emit), app/pages/index.vue:82-84 (select handler)
   - confidence: CONFIRMED
   - priority: P1
   - scope: AgentPicker.vue, index.vue, TerminalView.vue, useTerminal.ts

5. **Add per-agent launch defaults to Settings API** -- No mechanism to store per-agent launch defaults. Settings key-value store exists (settings table in SQLite) and supports arbitrary JSON. Store defaults at key `agent-launch-defaults:<agentId>`.
   - source: server/db/schema.ts:59-63 (settings table), server/api/settings/[key].put.ts
   - confidence: CONFIRMED
   - priority: P1
   - scope: server/routes/terminal.ts (inline read)

6. **Add per-agent launch defaults UI in Settings > Agents tab** -- AgentsTab.vue shows agent list but has no per-agent launch settings. Add a "Launch Defaults" section with toggles based on instanceType capabilities.
   - source: app/components/settings/AgentsTab.vue:135-367
   - confidence: CONFIRMED
   - priority: P2
   - scope: AgentsTab.vue

### Spike 4: AgentConfig Schema and Spawn Pipeline

- [x] SPIKE: Investigate schema and spawn pipeline changes

**Findings:**

7. **Add instanceType capability map** -- Need a shared capability map declaring which flags each instanceType supports, used by both server (validation) and client (show/hide toggles).
   - source: shared/types/agent.ts
   - confidence: CONFIRMED
   - priority: P2
   - scope: shared/types/agent.ts

## Priority Order

1. P1: Add launchOptions to AgentConfig type and agent registry (tack-ebs.5)
2. P1: Add launch options to spawn pipeline (tack-ebs.6) -- depends on #1
3. P1: Add per-agent launch defaults to Settings API (tack-ebs.7) -- depends on #1
4. P1: Wire session continue to use --continue on fresh spawn (tack-ebs.10) -- depends on #2
5. P1: Add launch options UI to AgentPicker before spawn (tack-ebs.8) -- depends on #2, #7
6. P2: Add instanceType capability map (tack-ebs.11) -- parallel with #1
7. P2: Add per-agent launch defaults UI in Settings > Agents tab (tack-ebs.9) -- depends on #3, #7

## Task Dependencies

<!-- tack-ebs.6 depends on tack-ebs.5 (spawn pipeline needs the type) -->
<!-- tack-ebs.7 depends on tack-ebs.5 (settings need the type) -->
<!-- tack-ebs.8 depends on tack-ebs.6 + tack-ebs.11 (UI needs pipeline + capability map) -->
<!-- tack-ebs.9 depends on tack-ebs.7 + tack-ebs.11 (settings UI needs API + capability map) -->
<!-- tack-ebs.10 depends on tack-ebs.6 (--continue wiring needs pipeline changes) -->

## Clean Areas

- **PTY session management** -- Reconnect via sessionId and tail buffer replay work correctly. No changes needed.
- **Agent registry CRUD** -- Custom agent create/edit/delete and built-in detection all work. Only need to add launchOptions field.
- **Settings API** -- Key-value store in SQLite with GET/PUT endpoints works. No schema changes needed, just new keys.
- **WebSocket control messages** -- Resize, drain, and session ID messages all work. Just need to add launch option params to the initial connection URL.
- **Terminal view lifecycle** -- Connect, reconnect, session expired, and PTY exit handling are solid. Only the Restart button behavior needs to change for --continue support.

---

# EPIC: Fix chat (driver) launch mode for CLI agents

Chat launch mode is broken for all CLI agents. When a user selects an agent and chooses "Chat" mode in AgentPicker, the UI enters an infinite "Agent is starting..." state. The SSE events endpoint hangs with only ping keepalives. The user can never send a message because the input is permanently disabled.

## Root Cause Analysis

The bug is a lifecycle gap between session creation and prompt readiness:

1. **AgentPicker** emits `select` with `panelType='driver'`
2. **index.vue** renders `AgentConversation` (not TerminalView) based on `panel.panelType === 'driver'`
3. **AgentConversation.onMounted** calls `driver.connect(agentId)` which:
   - POST `/api/agent/sessions` -> creates session, calls `CliAgentDriver.start()` (a no-op), sets `session.status = 'running'`
   - Opens EventSource to `/api/agent/sessions/{id}/events`
4. **SSE endpoint** replays buffered events (none exist) and attaches a live listener
5. **Client** sets `agentStatus = 'starting'` at connect time (useAgentDriver.ts:191)
6. **No events ever arrive** because `CliAgentDriver` is prompt-driven -- it does nothing until `sendPrompt()` is called
7. `agentStatus` stays `'starting'` forever because it only changes in the `es.onmessage` handler (useAgentDriver.ts:90-124)
8. **ConversationInput.isBusy** returns `true` when `agentStatus === 'starting'` (line 27-29), so `canSend` is always `false`
9. The user sees "Agent is starting..." with a spinning icon and a disabled input -- permanently

The MockAgentDriver works because it immediately streams events in `sendPrompt()`, but the real CliAgentDriver is designed for per-prompt CLI spawning (`--print` mode) and has no concept of an idle/ready state between prompts.

## Spike Findings

### Spike 1: Session Lifecycle Gap

- [x] SPIKE: Trace the chat launch lifecycle from AgentPicker through SSE

**Findings:**

53. **Emit a 'ready' event after session creation** -- When `AgentDriverManager.createSession()` completes (agent-driver.ts:788-789), the session status is set to `'running'` but no event is emitted. The SSE stream has no events to replay. The client-side `agentStatus` stays on `'starting'` because it only updates from incoming events. The session should emit a lifecycle event (e.g., `{ type: 'ready' }` or a status-change event) after `driver.start()` completes, signaling that the agent is ready to accept prompts.
    - source: server/services/agent-driver.ts:787-789 (createSession sets status but emits nothing)
    - confidence: CONFIRMED
    - priority: P0
    - scope: agent-driver.ts (AgentDriverManager.createSession and AgentDriverSession.emit)

54. **Add 'idle' status to AgentSessionStatus type** -- The current status enum is `'starting' | 'running' | 'waiting-approval' | 'complete' | 'error'`. There is no state representing "session is alive and ready for a prompt but not currently processing." The CliAgentDriver spawns a new process per `sendPrompt()` call and has no long-running process between prompts. Need an `'idle'` status that means "ready to accept input."
    - source: shared/types/agent-driver.ts:157 (status enum), app/composables/useAgentDriver.ts:12 (AgentSessionStatus type)
    - confidence: CONFIRMED
    - priority: P0
    - scope: shared/types/agent-driver.ts, app/composables/useAgentDriver.ts

55. **Handle 'ready' event in useAgentDriver composable** -- The client-side `es.onmessage` handler (useAgentDriver.ts:90-124) has no case for a 'ready' event type. When the server emits `{ type: 'ready' }`, the client must transition `agentStatus` from `'starting'` to `'idle'` (or equivalent), which unblocks the ConversationInput.
    - source: app/composables/useAgentDriver.ts:90-124 (switch on event.type)
    - confidence: CONFIRMED
    - priority: P0
    - scope: app/composables/useAgentDriver.ts

56. **Update ConversationInput isBusy to allow sending in idle state** -- `isBusy` is `true` when `agentStatus === 'starting' || agentStatus === 'running'` (ConversationInput.vue:27-29). Once `'idle'` status exists, `isBusy` must exclude it so the user can type and send. Also needs status indicator text and icon for the idle state.
    - source: app/components/driver/ConversationInput.vue:27-29, 41-61
    - confidence: CONFIRMED
    - priority: P0
    - scope: app/components/driver/ConversationInput.vue

### Spike 2: CliAgentDriver Prompt Lifecycle

- [x] SPIKE: Trace CliAgentDriver.sendPrompt and event emission

**Findings:**

57. **Transition to 'idle' after sendPrompt completes** -- `AgentDriverSession.sendPrompt()` (agent-driver.ts:105-127) iterates the driver's event generator and emits each event. After the generator completes, if the last event is a `'complete'` event, the session status becomes `'complete'`. But for a chat-mode session where the user may send multiple prompts, `'complete'` should not be the terminal state after each prompt. The session should transition to `'idle'` after a prompt exchange finishes (unless it truly errored or the user explicitly ends the session).
    - source: server/services/agent-driver.ts:105-127 (sendPrompt), 216-217 (complete sets status)
    - confidence: CONFIRMED
    - priority: P1
    - scope: server/services/agent-driver.ts (sendPrompt post-processing)

58. **Prevent session from entering 'complete' after first prompt in chat mode** -- The CliAgentDriver always yields a `'complete'` event at the end of `sendPrompt()` (agent-driver.ts:593-596 for plain stream, 593-596 for Claude Code stream). The session's emit handler sees `type === 'complete'` and sets `status = 'complete'` (agent-driver.ts:216-217). After this, subsequent `sendPrompt()` calls throw because status is `'complete'` (agent-driver.ts:106-108). Chat mode sessions need the complete event to signal "turn finished" without making the session permanently done.
    - source: server/services/agent-driver.ts:106-108 (guard), 216-217 (complete handler), 593-596 (CLI yields complete)
    - confidence: CONFIRMED
    - priority: P1
    - scope: server/services/agent-driver.ts

### Spike 3: Client-Side UI State Handling

- [x] SPIKE: Trace AgentConversation and ConversationInput state management

**Findings:**

59. **AgentConversation shows "Send a message to get started" but input is disabled** -- The empty state (AgentConversation.vue:392-403) shows "Send a message to get started" when `displayBlocks.length === 0 && driver.status.value !== 'error'`. This is correct -- the agent is connected with no events yet. But ConversationInput's `:disabled` prop is `driver.status.value !== 'connected'` (line 541), and the `isBusy` computed blocks sending when `agentStatus === 'starting'`. So the empty state prompt contradicts the disabled input.
    - source: app/components/driver/AgentConversation.vue:392-403, 541
    - confidence: CONFIRMED
    - priority: P1
    - scope: AgentConversation.vue, ConversationInput.vue

60. **Handle 'idle' status in AgentConversation's displayBlocks and showOverlay** -- `showOverlay` (AgentConversation.vue:345-347) only shows on `driver.status.value === 'error'`. The `displayBlocks` computed updates status indicators based on event types but has no handling for a 'ready' event. Need to handle the idle state in the conversation UI (e.g., show a ready indicator or simply not show anything -- the empty state is sufficient).
    - source: app/components/driver/AgentConversation.vue:345-347, 114-291
    - confidence: CONFIRMED
    - priority: P2
    - scope: app/components/driver/AgentConversation.vue

61. **Handle 'complete' -> 'idle' transition for multi-turn chat** -- When a prompt exchange completes, the client receives a `'complete'` event and sets `agentStatus = 'complete'`. ConversationInput shows "Agent completed" (line 47). For multi-turn chat, the user needs to be able to send follow-up messages. The status should transition from `'complete'` back to `'idle'` (or the input should remain enabled after completion).
    - source: app/composables/useAgentDriver.ts:111-115, app/components/driver/ConversationInput.vue:47
    - confidence: CONFIRMED
    - priority: P1
    - scope: useAgentDriver.ts, ConversationInput.vue

### Spike 4: HybridPanel Chat Mode

- [x] SPIKE: Review HybridPanel overlay behavior for chat launch

**Findings:**

62. **HybridPanel also affected by the same lifecycle gap** -- HybridPanel.vue auto-connects a driver on mount (line 29-33) alongside a TerminalView. It has the same issue: `driver.connect(agentId)` sets `agentStatus = 'starting'`, no events flow, `hasDriverSession` (line 23-25) may return false because `driver.agentStatus.value` is not null but `driver.status.value` starts as `'connecting'`. However, HybridPanel is less affected because the terminal still works -- the overlay is optional.
    - source: app/components/driver/HybridPanel.vue:22-34
    - confidence: CONFIRMED
    - priority: P2
    - scope: HybridPanel.vue (will be fixed by the same lifecycle changes)

### Deeper Spikes Needed

None -- the full lifecycle chain has been traced end-to-end.

### Clean Areas

- **SSE transport** -- Events endpoint (events.get.ts) correctly replays buffered events, attaches live listeners, sends keepalive pings, and cleans up on client disconnect. No changes needed to the transport layer.
- **MockAgentDriver** -- Works correctly because it emits events inline during sendPrompt(). The mock driver is fine for development testing.
- **AgentPicker launch mode selector** -- Correctly emits panelType='driver' when Chat is selected. No UI changes needed here.
- **Event type definitions** -- The discriminated union in shared/types/agent-driver.ts is well-structured. Just needs a ReadyEvent added.
- **CliAgentDriver stream parsing** -- Both parseClaudeCodeStream and parsePlainStream correctly parse CLI output into events. The parsing itself is solid.
- **Agent registry and detection** -- Agent configs, capabilities, and detection all work. The JSON array the user sees in the SSE response is likely a separate API response (GET /api/agents), not an SSE data frame.

## Priority Order

1. P0: Add 'idle' status to AgentSessionStatus type (#54)
2. P0: Emit a 'ready' event after session creation (#53) -- depends on #54
3. P0: Handle 'ready' event in useAgentDriver composable (#55) -- depends on #53
4. P0: Update ConversationInput isBusy to allow sending in idle state (#56) -- depends on #55
5. P1: Prevent session from entering 'complete' after first prompt in chat mode (#58)
6. P1: Transition to 'idle' after sendPrompt completes (#57) -- depends on #54, #58
7. P1: Handle 'complete' -> 'idle' transition for multi-turn chat (#61) -- depends on #57
8. P1: Fix AgentConversation empty state vs disabled input contradiction (#59) -- depends on #55
9. P2: Handle 'idle' status in AgentConversation displayBlocks (#60)
10. P2: HybridPanel overlay will be fixed by lifecycle changes (#62)

## Task Dependencies

<!-- depends-on relationships -->
<!-- #53 depends on #54 (ready event needs the idle status type to exist) -->
<!-- #55 depends on #53 (client handler needs the server to emit the event) -->
<!-- #56 depends on #55 (input unlock needs client to receive and process ready event) -->
<!-- #57 depends on #54 + #58 (idle transition needs status type + complete semantics fix) -->
<!-- #58 depends on #54 (complete->idle needs the idle status) -->
<!-- #59 depends on #55 (empty state fix depends on ready event handling) -->
<!-- #60 depends on #55 (display blocks need to know about ready/idle) -->
<!-- #61 depends on #57 (multi-turn needs idle transition after sendPrompt) -->
<!-- #62 is resolved by #53-#56 (no separate work needed) -->

## Critical Path

#54 (add idle status) -> #53 (emit ready event) -> #55 (handle ready on client) -> #56 (unlock input) = minimum viable fix for the infinite "starting" bug

Then: #58 (fix complete semantics) -> #57 (idle after prompt) -> #61 (multi-turn chat) = enables multi-turn conversation

## Parallel Opportunities

- #54 (type change) and preparatory reading are the only serial bottleneck
- After #56 is done (input unlocked), the P1 multi-turn fixes (#57, #58, #61) can proceed in parallel with P2 UI polish (#59, #60)

---

# EPIC: Fix two-way chat interface -- make driver chat a working conversation

The driver-based chat (AgentConversation) does not function as a two-way conversation. When a user types a message and presses enter, the text field clears and the panel shows "Complete" but no actual response content is visible. The chat needs to be a fully working two-way conversation with streamed responses.

## Status of Previous Fix Attempts

The TODO epic "Fix chat (driver) launch mode for CLI agents" (#53-#62) identified the lifecycle gap. Several fixes have already been applied to the codebase:

- [x] ReadyEvent type added to shared/types/agent-driver.ts:134-136
- [x] 'idle' status added to AgentDriverSession type (shared/types/agent-driver.ts:162)
- [x] Server emits 'ready' event after session creation (agent-driver.ts:795)
- [x] Client handles 'ready' event -> agentStatus = 'idle' (useAgentDriver.ts:91-92)
- [x] ConversationInput isBusy excludes 'idle' and 'complete' (ConversationInput.vue:27-29)
- [x] sendPrompt transitions server status back to 'idle' after completion (agent-driver.ts:118)

Despite these fixes, the chat still does not show response content.

## Spike Findings

### Spike 1: Driver Chat Lifecycle -- Why Messages Produce No Visible Response

- [x] SPIKE: Trace the full message lifecycle from send to render

**Findings:**

63. **Server 'idle' transition after sendPrompt has no event emission** -- After sendPrompt's for-await loop completes (agent-driver.ts:114-116), line 118 sets `this.status = 'idle'` but emits no event. The client receives the 'complete' event (from emit handler line 222-224) and stays on agentStatus='complete'. The server-side idle transition is invisible to the client.
    - source: server/services/agent-driver.ts:118 (status set), 222-224 (complete event sets status)
    - confidence: CONFIRMED
    - priority: P1
    - scope: agent-driver.ts (emit a 'ready' event after line 118)

64. **CliAgentDriver's 'complete' event conflicts with session's emit handler** -- The CliAgentDriver yields a 'complete' event at end of parseClaudeCodeStream (line 599-601) or parsePlainStream (line 657). The session's emit handler (line 222-224) sets `this.status = 'complete'`. Then sendPrompt overrides to 'idle' (line 118). But the SSE has already sent the 'complete' event to the client. For multi-turn chat, the 'complete' event should signal "turn finished" not "session done."
    - source: server/services/agent-driver.ts:222-224, 599-601, 657
    - confidence: CONFIRMED
    - priority: P0
    - scope: agent-driver.ts (either suppress 'complete' status change in emit during sendPrompt, or emit a follow-up 'ready' event)

65. **OracleChat (AI SDK Chat class) is unreachable dead code** -- OracleChat.vue is rendered via PluginPanel.vue, but PluginPanel is never used in any page or layout. The Oracle plugin's chat component, its server endpoint (chat.post.ts), and the OracleSettings component are all dead code.
    - source: app/components/PluginPanel.vue (exists but zero references in any .vue file), plugins/oracle/components/OracleChat.vue
    - confidence: CONFIRMED
    - priority: P2
    - scope: plugins/oracle/ (entire directory), app/components/PluginPanel.vue, server/api/plugins/oracle/chat.post.ts

66. **AgentMessageBus is unused infrastructure** -- The inter-agent messaging bus (server/services/agent-message-bus.ts) and its UI component (app/components/driver/MessageBusInspector.vue) are fully implemented but never called. No API endpoint invokes it. The MessageBusInspector component is auto-imported but never placed in any template.
    - source: server/services/agent-message-bus.ts (124 lines), app/components/driver/MessageBusInspector.vue
    - confidence: CONFIRMED
    - priority: P3
    - scope: Delete or integrate

67. **displayBlocks computed correctly processes events** -- The displayBlocks computed in AgentConversation.vue (line 118-295) properly accumulates text-delta events into text blocks and renders complete events with a green checkmark. If text-delta events arrive via SSE, they WILL render. The rendering pipeline is not the bug.
    - source: app/components/driver/AgentConversation.vue:118-295
    - confidence: CONFIRMED
    - priority: N/A (clean area)

68. **SSE transport correctly replays and streams events** -- The events.get.ts endpoint (line 26-63) replays buffered events on connect and attaches a live listener. If the session has events in its buffer, reconnecting clients get them. The transport layer is not the bug.
    - source: server/api/agent/sessions/[id]/events.get.ts:26-63
    - confidence: CONFIRMED
    - priority: N/A (clean area)

### Spike 2: Multi-Turn Conversation Support

- [x] SPIKE: Audit complete/idle transitions and event gaps

**Findings:**

69. **Client can send after 'complete' but UI is confusing** -- ConversationInput's `isBusy` (line 27-29) returns true only for 'starting' | 'running'. When agentStatus is 'complete', `canSend` is true (assuming text in input and connected). The user CAN type and send follow-up messages. However, the statusText shows "Agent completed" and the statusIcon shows a green checkmark, implying the session is done.
    - source: app/components/driver/ConversationInput.vue:27-29, 41-49
    - confidence: CONFIRMED
    - priority: P1
    - scope: ConversationInput.vue (update statusText for 'complete' when in multi-turn mode)

70. **sendPrompt guard allows second call because server status is 'idle'** -- The guard at agent-driver.ts:107 checks `this.status === 'complete' || this.status === 'error'`. Since line 118 sets status to 'idle' after the first prompt, the second sendPrompt call passes the guard. Multi-turn works server-side.
    - source: server/services/agent-driver.ts:107, 118
    - confidence: CONFIRMED
    - priority: N/A (working correctly)

71. **No user message is displayed in the conversation** -- AgentConversation's displayBlocks only processes server-side events (text-delta, tool-call, etc.). The user's prompt message is NOT added to the event stream or displayed as a chat bubble. The user types a message, it disappears, and only the assistant's response (if any) shows. This breaks the "two-way chat" feel -- the user needs to see their own messages.
    - source: app/components/driver/AgentConversation.vue:118-295 (no user message block type), app/composables/useAgentDriver.ts:221-229 (sendPrompt only POSTs, doesn't add local event)
    - confidence: CONFIRMED
    - priority: P0
    - scope: useAgentDriver.ts (add local user message to events), AgentConversation.vue (add user message block rendering)

### Spike 3: Redundant/Dead Code Audit

- [x] SPIKE: Audit OracleChat vs AgentConversation duplication

**Findings:**

See #65 (OracleChat dead code) and #66 (AgentMessageBus unused) above.

72. **HybridPanel.vue adds complexity without clear use case** -- HybridPanel renders both a TerminalView and an AgentConversation side-by-side. It auto-connects a driver on mount alongside the terminal. With the driver chat not working, this component adds unused complexity.
    - source: app/components/driver/HybridPanel.vue
    - confidence: CONFIRMED
    - priority: P3
    - scope: Evaluate whether HybridPanel is needed or should be deferred

73. **OrchestrationDashboard and DependencyGraph are scaffolded but likely unused** -- These driver components exist but may not be referenced in any active template.
    - source: app/components/driver/OrchestrationDashboard.vue, app/components/driver/DependencyGraph.vue
    - confidence: LIKELY
    - priority: P3
    - scope: Verify usage and remove if dead

## Priority Order

1. P0: Add user message display to conversation (#71) -- THE core missing feature
2. P0: Fix 'complete' event semantics for multi-turn (#64) -- emit 'ready' after sendPrompt
3. P1: Emit event for idle transition after sendPrompt (#63)
4. P1: Update ConversationInput statusText for multi-turn (#69)
5. P1: End-to-end test: have a conversation about Vue
6. P2: Remove OracleChat/PluginPanel dead code (#65)
7. P3: Remove/defer AgentMessageBus (#66), HybridPanel (#72), OrchestrationDashboard (#73)

## Task Dependencies

<!-- depends-on relationships -->
<!-- #64 depends on nothing (server-only change) -->
<!-- #63 depends on #64 (idle event only matters after complete semantics are fixed) -->
<!-- #71 depends on nothing (client-only change, can be done in parallel with #64) -->
<!-- #69 depends on #63 (status text update depends on receiving idle events) -->
<!-- E2E test depends on #71 + #64 (both core fixes must be in place) -->
<!-- #65, #66, #72, #73 are independent cleanup tasks -->

## Critical Path

#71 (user messages visible) + #64 (fix complete semantics) -> #63 (emit idle event) -> #69 (status text update) -> E2E test

## Parallel Opportunities

- #71 (client-side user message display) and #64 (server-side complete/idle fix) can be done in parallel
- Cleanup tasks (#65, #66, #72, #73) can be done at any time independently

## Clean Areas

- **SSE transport** -- events.get.ts correctly replays and streams events. No changes needed.
- **displayBlocks rendering** -- AgentConversation correctly processes all event types into display blocks. Rendering is not the issue.
- **CliAgentDriver stream parsing** -- Both parseClaudeCodeStream and parsePlainStream correctly parse CLI output. The parsing is solid.
- **ConversationInput autocomplete** -- Slash commands and @mentions work correctly with detection, navigation, and acceptance.
- **Agent registry and model config** -- Agent configs, capabilities, and environment setup work. No changes needed.
- **MarkdownRenderer** -- Custom markdown parser and CodeBlockRenderer work for all expected markdown features.

---

# EPIC: Streaming chat text, token usage, and tokens/sec display

Stream text in like how modern chats do it (no waiting 10 seconds then wall of text), show token usage and tokens per second.

## Spike Findings

### Spike 1: End-to-End Streaming Audit

- [x] SPIKE: Audit end-to-end streaming from CLI process through SSE to DOM

**Findings:**

The streaming pipeline has two issues causing the "wall of text" experience:

74. **Make prompt endpoint non-blocking so SSE streams events during CLI execution** -- prompt.post.ts (line 20-22) awaits `session.sendPrompt()` which blocks until the entire CLI process finishes. The client's `$fetch` call in useAgentDriver.ts:226-234 awaits the POST response. While SSE events DO flow via the listener during CLI execution, the client's await on the POST may prevent UI thread re-rendering until the response arrives. The fix is to return 202 Accepted immediately and run sendPrompt in background, or make the client fire-and-forget the POST.
    - source: server/api/agent/sessions/[id]/prompt.post.ts:20-22, app/composables/useAgentDriver.ts:226-234
    - confidence: CONFIRMED
    - priority: P0
    - scope: prompt.post.ts, useAgentDriver.ts

75. **Deduplicate assistant event text that duplicates streamed content_block_delta text** -- mapClaudeEvent handles both `content_block_delta` (incremental text_delta, line 698-706) and `assistant` (full message envelope, line 763-776). With `--output-format stream-json`, both arrive: content_block_delta events stream incrementally during generation, then the assistant event arrives at the end with the COMPLETE message. Both yield `text-delta` events, causing the response text to appear twice -- once streamed, once as a wall dump.
    - source: server/services/agent-driver.ts:698-706, 763-776
    - confidence: CONFIRMED
    - priority: P1
    - scope: agent-driver.ts (CliAgentDriver.mapClaudeEvent)

### Spike 2: Token Metrics

- [x] SPIKE: Token metrics collection and tokens-per-second calculation

**Findings:**

76. **Track cumulative token usage across turns and display in conversation footer** -- `tokensUsed` in useAgentDriver.ts:122-124 overwrites on each complete event rather than accumulating. Multi-turn conversation totals are lost. PanelHeader.vue:131-137 shows tokens from `injectedTokensUsed` which gets overwritten each turn. The complete block in AgentConversation.vue:543-548 already renders per-turn tokens.
    - source: app/composables/useAgentDriver.ts:122-124, app/components/PanelHeader.vue:131-137
    - confidence: CONFIRMED
    - priority: P1
    - scope: useAgentDriver.ts, PanelHeader.vue

77. **Calculate and display tokens-per-second during and after generation** -- No timing data is tracked for generation speed. Events already have `timestamp` fields (shared/types/agent-driver.ts:23). Need to track first text-delta timestamp per turn (generation start) and complete timestamp (generation end), then compute output_tokens / duration.
    - source: shared/types/agent-driver.ts:18-24
    - confidence: CONFIRMED
    - priority: P1
    - scope: useAgentDriver.ts, PanelHeader.vue, AgentConversation.vue
    <!-- depends on: #76 (cumulative tracking needed first) -->

78. **Add UsageEvent type to agent-driver protocol for incremental token updates** -- The discriminated union (shared/types/agent-driver.ts:147-159) has no event for mid-generation token counts. Claude Code `stream-json` emits `message_delta` events with `usage` fields that are currently skipped (agent-driver.ts:781). Need a `UsageEvent` type to transport this data.
    - source: shared/types/agent-driver.ts:147-159, server/services/agent-driver.ts:781
    - confidence: CONFIRMED
    - priority: P1
    - scope: shared/types/agent-driver.ts

79. **Extract usage data from message_delta events for real-time token counting** -- `mapClaudeEvent` skips `message_delta` entirely (line 781). These events carry `usage: { input_tokens, output_tokens }` during generation. Handling them enables live token count display before the complete event.
    - source: server/services/agent-driver.ts:781
    - confidence: CONFIRMED
    - priority: P1
    - scope: agent-driver.ts (mapClaudeEvent)
    <!-- depends on: #78 (UsageEvent type must exist) -->

### Spike 3: Progressive Rendering UX

- [x] SPIKE: Progressive rendering UX and perceived streaming quality

**Findings:**

80. **Optimize displayBlocks to avoid full recomputation on every text-delta event** -- `displayBlocks` (AgentConversation.vue:125-310) is a Vue computed that iterates ALL events and rebuilds ALL blocks on every new event. During active streaming with rapid text-delta events (30-50/sec from Claude Code), this means full array traversal + block reconstruction on every delta. For long responses this compounds.
    - source: app/components/driver/AgentConversation.vue:125-310
    - confidence: CONFIRMED
    - priority: P2
    - scope: AgentConversation.vue (displayBlocks computed)

81. **Batch rapid text-delta events to reduce render frequency during streaming** -- Each SSE event triggers `events.value = [...events.value, event]` (useAgentDriver.ts:87) which clones the entire events array, triggering Vue reactivity cascade -> displayBlocks recompute -> DOM update. At 30-50 events/sec this is excessive. Batching with requestAnimationFrame (one flush per frame, ~60fps) would reduce renders by 50-80%.
    - source: app/composables/useAgentDriver.ts:87
    - confidence: CONFIRMED
    - priority: P2
    - scope: useAgentDriver.ts
    <!-- depends on: #74 (non-blocking prompt must work first) -->

82. **Add live generation speed indicator to PanelHeader during streaming** -- PanelHeader.vue:131-137 shows total token count but no speed. During active generation (agentStatus === 'running'), show live tok/s alongside token count.
    - source: app/components/PanelHeader.vue:131-137
    - confidence: CONFIRMED
    - priority: P2
    - scope: PanelHeader.vue
    <!-- depends on: #78 (UsageEvent type), #77 (tok/s calculation) -->

## Priority Order

1. P0: Make prompt endpoint non-blocking (#74)
2. P1: Deduplicate assistant event text (#75)
3. P1: Add UsageEvent type (#78)
4. P1: Track cumulative token usage (#76)
5. P1: Extract message_delta usage data (#79) -- depends on #78
6. P1: Calculate tokens-per-second (#77) -- depends on #76
7. P2: Optimize displayBlocks (#80)
8. P2: Batch text-delta events (#81) -- depends on #74
9. P2: Live speed indicator (#82) -- depends on #78, #77

## Task Dependencies

<!-- depends-on relationships -->
<!-- #79 depends on #78 (usage event type must exist before extraction) -->
<!-- #77 depends on #76 (cumulative tracking needed for tok/s) -->
<!-- #81 depends on #74 (batching only matters when streaming works) -->
<!-- #82 depends on #78 + #77 (live indicator needs usage events + tok/s calc) -->

## Critical Path

#74 (non-blocking prompt) -> #81 (batch events) = streaming UX fix
#78 (UsageEvent type) -> #79 (extract usage from message_delta) = real-time token data
#76 (cumulative tokens) -> #77 (tok/s calc) -> #82 (live indicator) = metrics display

## Parallel Opportunities

- Wave 1 (no interdependencies): #74, #75, #78, #76, #80 -- all can proceed in parallel
- Backend tasks (#74, #75, #78, #79) can proceed in parallel with frontend tasks (#76, #80)
- After Wave 1 completes: #79, #77, #81 can proceed in parallel

## Clean Areas

- **SSE transport** -- events.get.ts correctly replays buffered events and streams live events. No changes needed to the transport layer.
- **MarkdownRenderer streaming** -- Already has a `streaming` prop that shows a cursor indicator. The renderer itself handles incomplete markdown gracefully (unclosed code fences are rendered anyway).
- **displayBlocks event processing** -- The block accumulation logic (text-delta merging, tool-call pairing, etc.) is correct. The issue is performance, not correctness.
- **PanelHeader token display** -- Already shows total tokens with formatTokens helper. Just needs cumulative tracking and speed data fed to it.
- **Auto-scroll during streaming** -- Already implemented with userScrolledUp detection and scroll-to-bottom button (AgentConversation.vue:332-358).
