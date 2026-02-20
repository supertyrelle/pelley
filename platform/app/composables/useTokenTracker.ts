import type { Ref } from 'vue'
import type { AgentDriverEvent, CompleteEvent } from '~~/shared/types/agent-driver'

// ---------------------------------------------------------------------------
// Model pricing table (per 1M tokens)
// ---------------------------------------------------------------------------

interface ModelPricing {
  input: number  // $ per 1M input tokens
  output: number // $ per 1M output tokens
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku-3.5': { input: 0.80, output: 4 },
  // OpenAI
  'gpt-4o': { input: 2.50, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'o3': { input: 10, output: 40 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'o4-mini': { input: 1.10, output: 4.40 },
  // Google
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
}

/**
 * Look up pricing by matching the start of the model name.
 * E.g. "claude-sonnet-4-20250514" matches "claude-sonnet-4".
 */
function findPricing(modelName: string): ModelPricing | null {
  // Exact match first
  if (MODEL_PRICING[modelName]) return MODEL_PRICING[modelName]

  // Prefix match (longest prefix wins)
  let bestMatch: ModelPricing | null = null
  let bestLen = 0

  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (modelName.startsWith(key) && key.length > bestLen) {
      bestMatch = pricing
      bestLen = key.length
    }
  }

  return bestMatch
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export interface TokenTrackerResult {
  totalInput: Ref<number>
  totalOutput: Ref<number>
  totalCost: Ref<number | null>
  formattedCost: Ref<string>
}

export function useTokenTracker(
  events: Ref<AgentDriverEvent[]>,
  modelName?: Ref<string | undefined>,
): TokenTrackerResult {
  // Accumulate tokens from all complete events in the stream
  const totalInput = computed(() => {
    let sum = 0
    for (const evt of events.value) {
      if (evt.type === 'complete') {
        const complete = evt as CompleteEvent
        if (complete.tokensUsed) {
          sum += complete.tokensUsed.input
        }
      }
    }
    return sum
  })

  const totalOutput = computed(() => {
    let sum = 0
    for (const evt of events.value) {
      if (evt.type === 'complete') {
        const complete = evt as CompleteEvent
        if (complete.tokensUsed) {
          sum += complete.tokensUsed.output
        }
      }
    }
    return sum
  })

  const totalCost = computed<number | null>(() => {
    const model = modelName?.value
    if (!model) return null

    const pricing = findPricing(model)
    if (!pricing) return null

    const inputCost = (totalInput.value / 1_000_000) * pricing.input
    const outputCost = (totalOutput.value / 1_000_000) * pricing.output
    return inputCost + outputCost
  })

  const formattedCost = computed(() => {
    const cost = totalCost.value
    if (cost === null) {
      // Show tokens only, no cost
      const total = totalInput.value + totalOutput.value
      if (total === 0) return ''
      return formatTokenCount(total) + ' tokens'
    }

    if (cost === 0) return ''

    // Format as currency
    if (cost < 0.01) {
      return `<$0.01`
    }
    return `$${cost.toFixed(2)}`
  })

  return {
    totalInput,
    totalOutput,
    totalCost,
    formattedCost,
  }
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}
