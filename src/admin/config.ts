import fs from 'node:fs/promises'
import path from 'node:path'

export interface AdminConfig {
  decksDir: string
  collectionsDir: string
  gitEnabled: boolean
  gitAutoCommit: boolean
  trustProxy: boolean
  secureCookies: boolean
  ipAllowList: string[]
  ipDenyList: string[]
  userAgentAllowList: string[]
  userAgentDenyList: string[]
  rateLimitEnabled: boolean
  rateLimitMaxAttempts: number
  rateLimitWindowMinutes: number
  failedAuthDelayMs: number
}

const DEFAULT_CONFIG = {
  decksDir: './decks',
  collectionsDir: './collections',
  gitEnabled: false,
  gitAutoCommit: false,
  trustProxy: false,
  secureCookies: false,
  ipAllowList: [] as string[],
  ipDenyList: [] as string[],
  userAgentAllowList: [] as string[],
  userAgentDenyList: [] as string[],
  rateLimitEnabled: true,
  rateLimitMaxAttempts: 5,
  rateLimitWindowMinutes: 5,
  failedAuthDelayMs: 3000,
} satisfies AdminConfig

function getConfigPath(): string {
  return path.join(process.cwd(), 'ritual.config.json')
}

export async function loadConfig(): Promise<AdminConfig> {
  const configPath = getConfigPath()
  try {
    const content = await fs.readFile(configPath, 'utf-8')
    const parsed = JSON.parse(content) as Partial<AdminConfig>
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export async function saveConfig(config: AdminConfig): Promise<void> {
  const configPath = getConfigPath()
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

export function getDefaultConfig(): AdminConfig {
  return { ...DEFAULT_CONFIG }
}
