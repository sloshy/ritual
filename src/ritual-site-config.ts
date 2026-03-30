import fs from 'node:fs/promises'
import path from 'node:path'
import { isValidSemver } from './semver'

export type CISystem = 'github-actions' | 'manual'
export type DeployMode = 'publish-for-me' | 'local-build'

export type GitHubActionsInitConfig = {
  ciSystem: 'github-actions'
  deployMode: DeployMode
  distDir: string
}

export type ManualInitConfig = {
  ciSystem: 'manual'
}

export type InitSiteConfig = GitHubActionsInitConfig | ManualInitConfig

export type RitualSiteConfig = InitSiteConfig & { version: string }

const CONFIG_FILENAME = 'ritual-site.json'

export function getRitualSiteConfigPath(): string {
  return path.join(process.cwd(), CONFIG_FILENAME)
}

/**
 * Parse a ritual-site.json file's contents into a RitualSiteConfig.
 * Returns the parsed config or an error string describing what is wrong.
 */
export function parseRitualSiteConfig(content: string): RitualSiteConfig | string {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return 'Invalid JSON in ritual-site.json'
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return 'ritual-site.json must contain a JSON object'
  }

  const obj = parsed as Record<string, unknown>

  if (typeof obj.version !== 'string') {
    return 'ritual-site.json: "version" must be a string'
  }
  if (!isValidSemver(obj.version)) {
    return 'ritual-site.json: "version" is not a valid semver string'
  }
  if (obj.ciSystem !== 'github-actions' && obj.ciSystem !== 'manual') {
    return 'ritual-site.json: "ciSystem" must be "github-actions" or "manual"'
  }

  if (obj.ciSystem === 'github-actions') {
    if (obj.deployMode !== 'publish-for-me' && obj.deployMode !== 'local-build') {
      return 'ritual-site.json: "deployMode" must be "publish-for-me" or "local-build"'
    }
    if (typeof obj.distDir !== 'string') {
      return 'ritual-site.json: "distDir" must be a string'
    }
    return {
      version: obj.version,
      ciSystem: obj.ciSystem,
      deployMode: obj.deployMode,
      distDir: obj.distDir,
    }
  }

  return { version: obj.version, ciSystem: obj.ciSystem }
}

/**
 * Load ritual-site.json from the current working directory.
 * Returns the config on success, null if the file doesn't exist, or an error
 * string if the file exists but cannot be parsed.
 */
export async function loadRitualSiteConfig(): Promise<RitualSiteConfig | null | string> {
  try {
    const content = await fs.readFile(getRitualSiteConfigPath(), 'utf-8')
    return parseRitualSiteConfig(content)
  } catch {
    return null
  }
}

export async function saveRitualSiteConfig(config: RitualSiteConfig): Promise<void> {
  await fs.writeFile(getRitualSiteConfigPath(), JSON.stringify(config, null, 2) + '\n', 'utf-8')
}
