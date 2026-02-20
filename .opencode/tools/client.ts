// Shared client singleton, initialized by the plugin that loads first.
// This avoids importing @opencode-ai/sdk directly, which has a broken
// exports map in v1.2.9 (exports point to ./dist/index.js but the
// published tarball has files at ./dist/src/index.js).

const g = globalThis as typeof globalThis & {
  __pelleyClient?: any
}

export function setClient(c: any) {
  g.__pelleyClient = c
}

export function getClient(): any {
  if (!g.__pelleyClient) {
    throw new Error(
      "pelley client not initialized. The skill plugin must load before tools that use the client.",
    )
  }
  return g.__pelleyClient
}

// For backward compatibility with existing tool imports
export const client = new Proxy({} as any, {
  get(_target, prop) {
    return getClient()[prop]
  },
})
