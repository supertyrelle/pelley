import { useModelRegistry } from '~~/server/services/model-registry'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ model?: string }>(event)

  if (!body.model) {
    throw createError({ statusCode: 400, message: 'Missing required field: model' })
  }

  const registry = useModelRegistry()

  // Check that Ollama is running before attempting pull
  const running = await registry.isOllamaRunning()
  if (!running) {
    throw createError({ statusCode: 503, message: 'Ollama is not running' })
  }

  // Stream the pull progress as newline-delimited JSON (NDJSON)
  setResponseHeader(event, 'Content-Type', 'application/x-ndjson')
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  setResponseHeader(event, 'Transfer-Encoding', 'chunked')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const progress of registry.pullOllamaModel(body.model!)) {
          const chunk = JSON.stringify(progress) + '\n'
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      }
      catch (err) {
        const message = err instanceof Error ? err.message : 'Pull failed'
        const errorChunk = JSON.stringify({ status: 'error', error: message }) + '\n'
        controller.enqueue(encoder.encode(errorChunk))
        controller.close()
      }
    },
  })

  return sendStream(event, stream)
})
