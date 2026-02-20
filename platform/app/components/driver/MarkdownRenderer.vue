<script setup lang="ts">
// ---------------------------------------------------------------------------
// MarkdownRenderer — renders markdown with rich formatting
// ---------------------------------------------------------------------------
// Uses a lightweight custom parser to avoid adding a dependency.
// Code blocks delegate to CodeBlockRenderer for consistent styling.
// ---------------------------------------------------------------------------

const props = withDefaults(defineProps<{
  content: string
  streaming?: boolean
}>(), {
  streaming: false,
})

// ---------------------------------------------------------------------------
// Parsed block types
// ---------------------------------------------------------------------------

interface CodeBlock {
  type: 'code'
  language: string
  code: string
}

interface HtmlBlock {
  type: 'html'
  html: string
}

interface TableBlock {
  type: 'table'
  headers: string[]
  alignments: ('left' | 'center' | 'right' | null)[]
  rows: string[][]
}

type Block = CodeBlock | HtmlBlock | TableBlock

// ---------------------------------------------------------------------------
// Inline markdown -> HTML
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function parseInline(text: string): string {
  let result = escapeHtml(text)

  // Images (before links so ![...](...) isn't captured as a link)
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="max-w-full rounded" />')

  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary-500 underline hover:text-primary-600">$1</a>')

  // Bold + italic
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  result = result.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>')

  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>')

  // Italic
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>')
  result = result.replace(/_(.+?)_/g, '<em>$1</em>')

  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, '<del>$1</del>')

  // Inline code (after escaping so backtick content is preserved)
  result = result.replace(/`([^`]+)`/g, '<code class="rounded bg-(--ui-bg-accented) px-1.5 py-0.5 font-mono text-xs text-(--ui-text)">$1</code>')

  return result
}

// ---------------------------------------------------------------------------
// Block-level parsing
// ---------------------------------------------------------------------------

function parseBlocks(source: string): Block[] {
  const lines = source.split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)/)
    if (fenceMatch) {
      const lang = fenceMatch[1] ?? ''
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        codeLines.push(lines[i]!)
        i++
      }
      // If streaming and we never found the closing fence, still render what we have
      if (i < lines.length) i++ // skip closing ```

      blocks.push({ type: 'code', language: lang, code: codeLines.join('\n') })
      continue
    }

    // Table detection: line has pipes and next line is a separator row
    if (line.includes('|') && i + 1 < lines.length && /^\|?[\s:-]+\|[\s:|.-]+$/.test(lines[i + 1]!)) {
      const table = parseTable(lines, i)
      if (table) {
        blocks.push(table.block)
        i = table.nextIndex
        continue
      }
    }

    // Everything else: accumulate consecutive non-special lines into an HTML block
    const htmlLines: string[] = []
    while (i < lines.length) {
      const current = lines[i]!
      // Stop if we hit a code fence or a table
      if (current.match(/^```/)) break
      if (current.includes('|') && i + 1 < lines.length && /^\|?[\s:-]+\|[\s:|.-]+$/.test(lines[i + 1]!)) break
      htmlLines.push(current)
      i++
    }

    if (htmlLines.length > 0) {
      const html = renderHtmlLines(htmlLines)
      if (html.trim()) {
        blocks.push({ type: 'html', html })
      }
    }
  }

  return blocks
}

function parseTable(lines: string[], startIndex: number): { block: TableBlock; nextIndex: number } | null {
  const headerLine = lines[startIndex]!
  const separatorLine = lines[startIndex + 1]!

  const parseCells = (line: string): string[] =>
    line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

  const headers = parseCells(headerLine)
  const separators = parseCells(separatorLine)

  const alignments: ('left' | 'center' | 'right' | null)[] = separators.map((sep) => {
    const left = sep.startsWith(':')
    const right = sep.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })

  const rows: string[][] = []
  let i = startIndex + 2
  while (i < lines.length && lines[i]!.includes('|')) {
    rows.push(parseCells(lines[i]!))
    i++
  }

  return {
    block: { type: 'table', headers, alignments, rows },
    nextIndex: i,
  }
}

function renderHtmlLines(lines: string[]): string {
  const parts: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    // Empty line -> paragraph break
    if (line.trim() === '') {
      i++
      continue
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1]!.length
      const text = parseInline(headingMatch[2]!)
      const sizes: Record<number, string> = {
        1: 'text-2xl font-bold',
        2: 'text-xl font-semibold',
        3: 'text-lg font-semibold',
        4: 'text-base font-semibold',
        5: 'text-sm font-semibold',
        6: 'text-sm font-medium',
      }
      parts.push(`<h${level} class="${sizes[level]} text-(--ui-text) mt-4 mb-2">${text}</h${level}>`)
      i++
      continue
    }

    // Blockquote
    if (line.startsWith('> ') || line === '>') {
      const quoteLines: string[] = []
      while (i < lines.length && (lines[i]!.startsWith('> ') || lines[i]! === '>')) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ''))
        i++
      }
      const content = quoteLines.map(l => parseInline(l)).join('<br />')
      parts.push(`<blockquote class="border-l-3 border-(--ui-border-accented) pl-3 text-(--ui-text-muted) italic my-2">${content}</blockquote>`)
      continue
    }

    // Unordered list
    if (/^[\s]*[-*+]\s/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^[\s]*[-*+]\s/.test(lines[i]!)) {
        listItems.push(parseInline(lines[i]!.replace(/^[\s]*[-*+]\s/, '')))
        i++
      }
      const lis = listItems.map(item => `<li>${item}</li>`).join('')
      parts.push(`<ul class="list-disc pl-5 my-2 space-y-1 text-(--ui-text)">${lis}</ul>`)
      continue
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) {
        listItems.push(parseInline(lines[i]!.replace(/^\d+\.\s/, '')))
        i++
      }
      const lis = listItems.map(item => `<li>${item}</li>`).join('')
      parts.push(`<ol class="list-decimal pl-5 my-2 space-y-1 text-(--ui-text)">${lis}</ol>`)
      continue
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      parts.push('<hr class="border-(--ui-border) my-4" />')
      i++
      continue
    }

    // Regular paragraph: accumulate consecutive non-empty, non-special lines
    const paraLines: string[] = []
    while (i < lines.length && lines[i]!.trim() !== '' && !lines[i]!.match(/^#{1,6}\s/) && !lines[i]!.startsWith('> ') && !/^[\s]*[-*+]\s/.test(lines[i]!) && !/^\d+\.\s/.test(lines[i]!) && !/^[-*_]{3,}\s*$/.test(lines[i]!)) {
      paraLines.push(lines[i]!)
      i++
    }
    if (paraLines.length > 0) {
      const text = paraLines.map(l => parseInline(l)).join(' ')
      parts.push(`<p class="text-(--ui-text) my-2 leading-relaxed">${text}</p>`)
    }
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Reactive parsed output
// ---------------------------------------------------------------------------

const blocks = computed(() => parseBlocks(props.content))
</script>

<template>
  <div class="markdown-renderer text-sm">
    <template v-for="(block, index) in blocks" :key="index">
      <!-- Code blocks delegate to CodeBlockRenderer -->
      <div v-if="block.type === 'code'" class="my-3">
        <CodeBlockRenderer
          :code="block.code"
          :language="block.language || undefined"
          :show-line-numbers="block.code.split('\n').length > 3"
        />
      </div>

      <!-- Tables -->
      <div v-else-if="block.type === 'table'" class="my-3 overflow-x-auto">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th
                v-for="(header, hi) in block.headers"
                :key="hi"
                class="border border-(--ui-border) bg-(--ui-bg-elevated) px-3 py-1.5 text-xs font-semibold text-(--ui-text)"
                :style="block.alignments[hi] ? { textAlign: block.alignments[hi]! } : undefined"
              >
                {{ header }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in block.rows" :key="ri">
              <td
                v-for="(cell, ci) in row"
                :key="ci"
                class="border border-(--ui-border) px-3 py-1.5 text-(--ui-text)"
                :style="block.alignments[ci] ? { textAlign: block.alignments[ci]! } : undefined"
                v-html="parseInline(cell)"
              />
            </tr>
          </tbody>
        </table>
      </div>

      <!-- HTML blocks (headings, paragraphs, lists, blockquotes) -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-else v-html="block.html" />
    </template>

    <!-- Streaming cursor indicator -->
    <span
      v-if="streaming"
      class="inline-block h-4 w-0.5 animate-pulse bg-(--ui-text-muted)"
    />
  </div>
</template>
