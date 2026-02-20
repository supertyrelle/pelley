import type { ITheme } from '@xterm/xterm'
import type { TerminalThemePalette } from '~~/shared/types/theme'

const STORAGE_KEY = 'platform:terminal-theme'

const terminalPalettes: Record<TerminalThemePalette, { light: ITheme; dark: ITheme }> = {
  pelley: {
    dark: {
      background: '#2b1f28',
      foreground: '#e8d8e2',
      cursor: '#f472b6',
      selectionBackground: '#3d2e3a',
      black: '#2b1f28',
      red: '#f87171',
      green: '#86efac',
      yellow: '#fde68a',
      blue: '#93c5fd',
      magenta: '#f0abfc',
      cyan: '#67e8f9',
      white: '#e8d8e2',
      brightBlack: '#5c4a56',
      brightRed: '#fca5a5',
      brightGreen: '#bbf7d0',
      brightYellow: '#fef08a',
      brightBlue: '#bfdbfe',
      brightMagenta: '#f5d0fe',
      brightCyan: '#a5f3fc',
      brightWhite: '#fdf2f8',
    },
    light: {
      background: '#fdf2f4',
      foreground: '#3d2e3a',
      cursor: '#db2777',
      selectionBackground: '#fce7f3',
      black: '#3d2e3a',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#ca8a04',
      blue: '#2563eb',
      magenta: '#c026d3',
      cyan: '#0891b2',
      white: '#fdf2f4',
      brightBlack: '#5c4a56',
      brightRed: '#ef4444',
      brightGreen: '#22c55e',
      brightYellow: '#eab308',
      brightBlue: '#3b82f6',
      brightMagenta: '#d946ef',
      brightCyan: '#06b6d4',
      brightWhite: '#ffffff',
    },
  },
  default: {
    dark: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      selectionBackground: '#264f78',
      black: '#1e1e1e',
      red: '#f44747',
      green: '#6a9955',
      yellow: '#d7ba7d',
      blue: '#569cd6',
      magenta: '#c586c0',
      cyan: '#4ec9b0',
      white: '#d4d4d4',
      brightBlack: '#808080',
      brightRed: '#f44747',
      brightGreen: '#6a9955',
      brightYellow: '#d7ba7d',
      brightBlue: '#569cd6',
      brightMagenta: '#c586c0',
      brightCyan: '#4ec9b0',
      brightWhite: '#e8e8e8',
    },
    light: {
      background: '#ffffff',
      foreground: '#383a42',
      cursor: '#383a42',
      selectionBackground: '#bfceff',
      black: '#383a42',
      red: '#e45649',
      green: '#50a14f',
      yellow: '#c18401',
      blue: '#4078f2',
      magenta: '#a626a4',
      cyan: '#0184bc',
      white: '#fafafa',
      brightBlack: '#4f525e',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff',
    },
  },
}

const PALETTE_NAMES = Object.keys(terminalPalettes) as TerminalThemePalette[]

function loadSavedPalette(): TerminalThemePalette {
  if (!import.meta.client) return 'pelley'
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && saved in terminalPalettes) return saved as TerminalThemePalette
  return 'pelley'
}

const activeTerminalPalette = ref<TerminalThemePalette>(loadSavedPalette())

export function useTheme() {
  const colorMode = useColorMode()

  function setTerminalPalette(palette: TerminalThemePalette) {
    activeTerminalPalette.value = palette
    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, palette)
    }
  }

  function getTerminalTheme(): ITheme {
    const palette = terminalPalettes[activeTerminalPalette.value] ?? terminalPalettes.pelley
    return colorMode.value === 'light' ? palette.light : palette.dark
  }

  return {
    colorMode,
    activeTerminalPalette: readonly(activeTerminalPalette),
    terminalPaletteNames: PALETTE_NAMES,
    setTerminalPalette,
    getTerminalTheme,
  }
}
