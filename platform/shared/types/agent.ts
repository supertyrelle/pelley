export interface LaunchOptions {
  sessionContinue?: boolean
  permissionSkip?: boolean
  modelOverride?: { provider: string; model: string }
}

export interface InstanceCapabilities {
  sessionContinue: boolean
  permissionSkip: boolean
  continueFlag: string | null
  permissionSkipFlag: string | null
}

export interface AgentConfig {
  id: string
  name: string
  command: string
  args: string[]
  resumeArgs?: string[]
  launchOptions?: LaunchOptions
  instanceType: 'claude-code' | 'opencode' | 'kimi-code' | 'llmcp' | 'custom'
  modelConfig?: {
    provider: string
    model: string
    apiBaseUrl?: string
    apiKeyEnvVar?: string
    contextWindow?: number
  }
}

export const INSTANCE_CAPABILITIES: Record<AgentConfig['instanceType'], InstanceCapabilities> = {
  'claude-code': { sessionContinue: true, permissionSkip: true, continueFlag: '--continue', permissionSkipFlag: '--dangerously-skip-permissions' },
  'kimi-code': { sessionContinue: true, permissionSkip: true, continueFlag: '--continue', permissionSkipFlag: '--yolo' },
  'opencode': { sessionContinue: true, permissionSkip: false, continueFlag: '--continue', permissionSkipFlag: null },
  'llmcp': { sessionContinue: false, permissionSkip: false, continueFlag: null, permissionSkipFlag: null },
  'custom': { sessionContinue: false, permissionSkip: false, continueFlag: null, permissionSkipFlag: null },
}

export function launchFlags(instanceType: AgentConfig['instanceType'], options: LaunchOptions): string[] {
  const caps = INSTANCE_CAPABILITIES[instanceType]
  if (!caps) return []
  const flags: string[] = []
  if (options.sessionContinue && caps.continueFlag) flags.push(caps.continueFlag)
  if (options.permissionSkip && caps.permissionSkipFlag) flags.push(caps.permissionSkipFlag)
  return flags
}
