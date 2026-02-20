export type TerminalConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'

import type { LaunchOptions } from '~~/shared/types/agent'

export type PanelType = 'terminal' | 'driver' | 'plugin'

export interface PanelState {
  id: string
  panelType: PanelType
  agentId?: string
  agentName?: string
  sessionId?: string
  launchOptions?: LaunchOptions
  widthPercent: number
  minWidth: number
  isActive: boolean
}

const STORAGE_KEY = 'tiling-layout-panels'
const MAX_PANELS = 6
const DEFAULT_MIN_WIDTH = 300

function generateId(): string {
  return `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function redistributeWidths(panels: PanelState[]): PanelState[] {
  if (panels.length === 0) return panels
  const equal = 100 / panels.length
  for (const p of panels) {
    p.widthPercent = equal
  }
  return panels
}

function loadFromStorage(): PanelState[] | null {
  if (import.meta.server) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Intentionally reject empty arrays: closing all panels then reloading
    // should restore a fresh default panel, not persist the empty state
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
  } catch {
    // corrupted storage, ignore
  }
  return null
}

function saveToStorage(panels: PanelState[]) {
  if (import.meta.server) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panels))
  } catch {
    // storage full or unavailable, ignore
  }
}

export function useTilingLayout() {
  const stored = loadFromStorage()
  const initial: PanelState[] = stored ?? [
    {
      id: generateId(),
      panelType: 'terminal',
      widthPercent: 100,
      minWidth: DEFAULT_MIN_WIDTH,
      isActive: true,
    },
  ]

  const panels = useState<PanelState[]>('tiling-panels', () => initial)
  const terminalStatuses = useState<Record<string, TerminalConnectionStatus>>('terminal-statuses', () => ({}))
  const terminalActivities = useState<Record<string, boolean>>('terminal-activities', () => ({}))

  function persist() {
    saveToStorage(panels.value)
  }

  function addPanel(agentId?: string, panelType: PanelType = 'terminal') {
    if (panels.value.length >= MAX_PANELS) return

    const newPanel: PanelState = {
      id: generateId(),
      panelType,
      agentId,
      widthPercent: 0, // will be redistributed
      minWidth: DEFAULT_MIN_WIDTH,
      isActive: false,
    }

    panels.value = redistributeWidths([...panels.value, newPanel])
    persist()
  }

  function removePanel(id: string) {
    const filtered = panels.value.filter(p => p.id !== id)
    const wasActive = panels.value.find(p => p.id === id)?.isActive

    panels.value = redistributeWidths(filtered)

    // if the removed panel was active, activate the first one
    if (wasActive && panels.value.length > 0) {
      panels.value[0]!.isActive = true
    }

    persist()
  }

  function resizePanel(id: string, newWidthPercent: number) {
    const idx = panels.value.findIndex(p => p.id === id)
    if (idx === -1 || idx >= panels.value.length - 1) return

    // clamp to reasonable bounds
    const minPercent = 10
    const maxPercent = 90
    const clamped = Math.max(minPercent, Math.min(maxPercent, newWidthPercent))

    const current = panels.value[idx]!
    const neighbor = panels.value[idx + 1]!
    const combined = current.widthPercent + neighbor.widthPercent
    const neighborNew = combined - clamped

    // ensure neighbor also stays above minimum
    if (neighborNew < minPercent) return

    // Mutate in-place to preserve object identity -- avoids remounting
    // components keyed on panel.id in the v-for loop
    current.widthPercent = clamped
    neighbor.widthPercent = neighborNew

    persist()
  }

  function setActivePanel(id: string) {
    // Mutate in-place to preserve object identity -- the old .map() created
    // new objects for every panel, causing Vue to see all panels as changed
    for (const panel of panels.value) {
      panel.isActive = panel.id === id
    }
    persist()
  }

  function resetWidths() {
    panels.value = redistributeWidths(panels.value)
    persist()
  }

  function setTerminalStatus(panelId: string, status: TerminalConnectionStatus) {
    terminalStatuses.value = { ...terminalStatuses.value, [panelId]: status }
  }

  function getTerminalStatus(panelId: string): TerminalConnectionStatus {
    return terminalStatuses.value[panelId] ?? 'disconnected'
  }

  function setTerminalActivity(panelId: string, idle: boolean) {
    terminalActivities.value = { ...terminalActivities.value, [panelId]: idle }
  }

  function getTerminalActivity(panelId: string): boolean {
    return terminalActivities.value[panelId] ?? false
  }

  function updatePanel(id: string, updates: Partial<Pick<PanelState, 'agentId' | 'agentName' | 'sessionId' | 'launchOptions' | 'panelType'>>) {
    const panel = panels.value.find(p => p.id === id)
    if (!panel) return

    // Mutate in-place to preserve object identity
    Object.assign(panel, updates)
    persist()
  }

  return {
    panels: readonly(panels),
    addPanel,
    removePanel,
    resizePanel,
    setActivePanel,
    resetWidths,
    updatePanel,
    setTerminalStatus,
    getTerminalStatus,
    setTerminalActivity,
    getTerminalActivity,
    terminalStatuses: readonly(terminalStatuses),
    terminalActivities: readonly(terminalActivities),
    maxPanels: MAX_PANELS,
  }
}
