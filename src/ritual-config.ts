import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from './base-dir'
import { isValidSemver } from './semver'

export type CISystem = 'github-actions' | 'manual'
export type DeployMode = 'publish-for-me' | 'local-build'

export type GitHubActionsSiteConfig = {
  ciSystem: 'github-actions'
  deployMode: DeployMode
  distDir: string
  detectChanges: boolean
}

export type ManualSiteConfig = {
  ciSystem: 'manual'
}

/** Site config without a Ritual version — used during interactive `init-site` prompts. */
export type InitSiteConfig = GitHubActionsSiteConfig | ManualSiteConfig

/** Site config persisted on disk, including the Ritual version that initialized it. */
export type SiteConfig = InitSiteConfig & { version: string }

export interface RitualConfig {
  decksDir: string
  collectionsDir: string
  wantedDir: string
  gitEnabled: boolean
  gitAutoCommit: boolean
  gitAutoPush: boolean
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
  /** Present only when `ritual init-site` has been run; managed exclusively by that command. */
  site?: SiteConfig
}

const DEFAULT_CONFIG = {
  decksDir: './decks',
  collectionsDir: './collections',
  wantedDir: './wanted',
  gitEnabled: false,
  gitAutoCommit: false,
  gitAutoPush: false,
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
} satisfies RitualConfig

const CONFIG_FILENAME = 'ritual.config.json'

let cachedConfig: RitualConfig | null = null

export function getRitualConfigPath(): string {
  return path.join(getBaseDir(), CONFIG_FILENAME)
}

export function getDefaultRitualConfig(): RitualConfig {
  return { ...DEFAULT_CONFIG }
}

/**
 * Parse the `site` sub-object of a ritual.config.json. Returns the parsed
 * site config or an error string describing what is wrong.
 */
export function parseSiteConfig(value: unknown): SiteConfig | string {
  if (typeof value !== 'object' || value === null) {
    return 'site config must be a JSON object'
  }
  const obj = value as Record<string, unknown>

  if (typeof obj.version !== 'string') {
    return 'site config: "version" must be a string'
  }
  if (!isValidSemver(obj.version)) {
    return 'site config: "version" is not a valid semver string'
  }
  if (obj.ciSystem !== 'github-actions' && obj.ciSystem !== 'manual') {
    return 'site config: "ciSystem" must be "github-actions" or "manual"'
  }

  if (obj.ciSystem === 'github-actions') {
    if (obj.deployMode !== 'publish-for-me' && obj.deployMode !== 'local-build') {
      return 'site config: "deployMode" must be "publish-for-me" or "local-build"'
    }
    if (typeof obj.distDir !== 'string') {
      return 'site config: "distDir" must be a string'
    }
    if (typeof obj.detectChanges !== 'boolean') {
      return 'site config: "detectChanges" must be a boolean'
    }
    return {
      version: obj.version,
      ciSystem: obj.ciSystem,
      deployMode: obj.deployMode,
      distDir: obj.distDir,
      detectChanges: obj.detectChanges,
    }
  }

  return { version: obj.version, ciSystem: obj.ciSystem }
}

type ParsedConfigWithSite = Partial<RitualConfig> & { site?: unknown }

function applyDefaults(parsed: ParsedConfigWithSite): RitualConfig {
  const merged: RitualConfig = { ...DEFAULT_CONFIG, ...parsed, site: undefined }
  if (parsed.site !== undefined) {
    const site = parseSiteConfig(parsed.site)
    if (typeof site !== 'string') {
      merged.site = site
    } else {
      console.warn(`ritual.config.json: ignoring invalid site config — ${site}`)
    }
  }
  return merged
}

async function readConfigFromDisk(): Promise<RitualConfig | null> {
  try {
    const content = await fs.readFile(getRitualConfigPath(), 'utf-8')
    const parsed = JSON.parse(content) as ParsedConfigWithSite
    return applyDefaults(parsed)
  } catch {
    return null
  }
}

/**
 * Load ritual.config.json from the base dir, merging with defaults.
 * Returns the default config if the file does not exist.
 */
export async function loadRitualConfig(): Promise<RitualConfig> {
  const fromDisk = await readConfigFromDisk()
  return fromDisk ?? { ...DEFAULT_CONFIG }
}

export async function saveRitualConfig(config: RitualConfig): Promise<void> {
  await fs.writeFile(getRitualConfigPath(), JSON.stringify(config, null, 2) + '\n', 'utf-8')
  cachedConfig = { ...config }
}

/**
 * Initialize the cached ritual config. Reads ritual.config.json from the base
 * dir, or creates it with default settings if it does not exist. Must be
 * called after setBaseDir() and before any sync getter is used.
 */
export async function initRitualConfig(): Promise<RitualConfig> {
  const fromDisk = await readConfigFromDisk()
  if (fromDisk) {
    cachedConfig = fromDisk
    return fromDisk
  }
  const defaults = { ...DEFAULT_CONFIG }
  try {
    await saveRitualConfig(defaults)
  } catch {
    // If we can't persist (e.g. read-only fs), still cache defaults so the
    // current invocation works.
    cachedConfig = defaults
  }
  return defaults
}

/**
 * Re-read ritual.config.json into the cache. Use after the admin server
 * persists a config update so subsequent reads reflect the new values.
 */
export async function reloadRitualConfig(): Promise<RitualConfig> {
  const fromDisk = await readConfigFromDisk()
  cachedConfig = fromDisk ?? { ...DEFAULT_CONFIG }
  return cachedConfig
}

/**
 * Sync access to the cached ritual config. Falls back to defaults if
 * initRitualConfig() was never called (e.g. in tests that bypass index.ts).
 */
export function getRitualConfig(): RitualConfig {
  return cachedConfig ?? { ...DEFAULT_CONFIG }
}

function resolveDir(dir: string): string {
  return path.resolve(getBaseDir(), dir)
}

export function getDecksDir(config: RitualConfig = getRitualConfig()): string {
  return resolveDir(config.decksDir)
}

export function getCollectionsDir(config: RitualConfig = getRitualConfig()): string {
  return resolveDir(config.collectionsDir)
}

export function getWantedDir(config: RitualConfig = getRitualConfig()): string {
  return resolveDir(config.wantedDir)
}

/**
 * Reset the cached config. Intended for tests.
 */
export function resetRitualConfigCache(): void {
  cachedConfig = null
}
