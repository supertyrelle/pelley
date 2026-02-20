export interface KeyBinding {
  id: string
  keys: string // e.g., 'Ctrl+Shift+T', 'Alt+1'
  description: string
  action: () => void
  category: 'panels' | 'navigation' | 'general'
  enabled?: boolean
}

interface ParsedCombo {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  key: string // lowercase
}

function parseKeyCombo(keys: string): ParsedCombo {
  const parts = keys.split('+').map(s => s.trim())
  const combo: ParsedCombo = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    key: '',
  }

  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'ctrl' || lower === 'control') combo.ctrl = true
    else if (lower === 'shift') combo.shift = true
    else if (lower === 'alt' || lower === 'option') combo.alt = true
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command') combo.meta = true
    else combo.key = lower
  }

  return combo
}

function eventMatchesCombo(e: KeyboardEvent, combo: ParsedCombo): boolean {
  // On Mac, treat Ctrl in our shortcut definitions as Cmd (Meta) for consistency.
  // Users press Cmd+Shift+T on Mac, Ctrl+Shift+T on other platforms.
  const isMac = navigator.platform.toUpperCase().includes('MAC')

  const wantCtrl = combo.ctrl
  const ctrlMatch = isMac
    ? (wantCtrl ? e.metaKey : !e.metaKey)
    : (wantCtrl ? e.ctrlKey : !e.ctrlKey)

  // On Mac, ignore the physical Ctrl key state when we're mapping Ctrl->Meta
  const physicalCtrlOk = isMac ? true : !e.metaKey

  const shiftMatch = combo.shift ? e.shiftKey : !e.shiftKey
  const altMatch = combo.alt ? e.altKey : !e.altKey

  // Normalize the event key for comparison
  let eventKey = e.key.toLowerCase()
  // Map special key names
  if (eventKey === 'arrowleft') eventKey = 'left'
  if (eventKey === 'arrowright') eventKey = 'right'
  if (eventKey === 'arrowup') eventKey = 'up'
  if (eventKey === 'arrowdown') eventKey = 'down'
  if (eventKey === '=') eventKey = '='
  if (eventKey === '?') eventKey = '?'
  // Escape already maps fine

  const keyMatch = eventKey === combo.key

  return ctrlMatch && physicalCtrlOk && shiftMatch && altMatch && keyMatch
}

function isTerminalFocused(): boolean {
  const active = document.activeElement
  if (!active) return false
  return active.closest('.xterm') !== null
}

function isCtrlShiftCombo(combo: ParsedCombo): boolean {
  return combo.ctrl && combo.shift
}

export function useKeyboardShortcuts() {
  const bindings = useState<KeyBinding[]>('keyboard-shortcuts', () => [])

  function register(binding: KeyBinding) {
    if (!import.meta.client) return
    const idx = bindings.value.findIndex(b => b.id === binding.id)
    if (idx !== -1) {
      bindings.value[idx] = binding
    } else {
      bindings.value = [...bindings.value, binding]
    }
  }

  function unregister(id: string) {
    bindings.value = bindings.value.filter(b => b.id !== id)
  }

  function getAll(): KeyBinding[] {
    return bindings.value
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Skip if we're in an input/textarea that isn't inside a terminal
    const target = e.target as HTMLElement
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
    const inTerminal = isTerminalFocused()

    for (const binding of bindings.value) {
      if (binding.enabled === false) continue

      const combo = parseKeyCombo(binding.keys)

      if (!eventMatchesCombo(e, combo)) continue

      // Terminal passthrough: when terminal is focused, only intercept Ctrl+Shift combos
      if (inTerminal && !isCtrlShiftCombo(combo)) continue

      // For non-terminal inputs, skip non-Ctrl/Meta shortcuts to allow normal typing
      if (isInput && !inTerminal && !combo.ctrl && !combo.alt && !combo.meta) continue

      e.preventDefault()
      e.stopPropagation()
      binding.action()
      return
    }
  }

  // Only attach listener on client
  if (import.meta.client) {
    onMounted(() => {
      document.addEventListener('keydown', handleKeyDown, true)
    })

    onUnmounted(() => {
      document.removeEventListener('keydown', handleKeyDown, true)
    })
  }

  return {
    register,
    unregister,
    getAll,
    isTerminalFocused,
    bindings: readonly(bindings),
  }
}
