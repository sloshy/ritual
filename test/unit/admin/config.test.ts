import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  loadConfig,
  saveConfig,
  getDefaultConfig,
  type AdminConfig,
} from '../../../src/admin/config'
import { setBaseDir } from '../../../src/base-dir'

const testDir = path.join(import.meta.dir, '../../.test-admin-config')
const configPath = path.join(testDir, 'ritual.config.json')

describe('admin config', () => {
  const originalCwd = process.cwd()

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true })
    setBaseDir(testDir)
  })

  afterEach(async () => {
    setBaseDir(originalCwd)
    await fs.rm(testDir, { recursive: true, force: true })
  })

  test('getDefaultConfig returns default values', () => {
    const config = getDefaultConfig()
    expect(config.decksDir).toBe('./decks')
    expect(config.collectionsDir).toBe('./collections')
    expect(config.gitEnabled).toBe(false)
    expect(config.gitAutoCommit).toBe(false)
    expect(config.gitAutoPush).toBe(false)
  })

  test('loadConfig returns defaults when file does not exist', async () => {
    const config = await loadConfig()
    expect(config.decksDir).toBe('./decks')
    expect(config.gitEnabled).toBe(false)
  })

  test('saveConfig and loadConfig round-trip', async () => {
    const config: AdminConfig = {
      decksDir: './my-decks',
      collectionsDir: './my-collections',
      gitEnabled: true,
      gitAutoCommit: true,
      gitAutoPush: false,
      trustProxy: false,
      secureCookies: false,
      ipAllowList: ['192.168.1.*'],
      ipDenyList: [],
      userAgentAllowList: [],
      userAgentDenyList: ['*bot*'],
      rateLimitEnabled: true,
      rateLimitMaxAttempts: 10,
      rateLimitWindowMinutes: 10,
      failedAuthDelayMs: 5000,
    }
    await saveConfig(config)

    const loaded = await loadConfig()
    expect(loaded).toEqual(config)
  })

  test('loadConfig merges partial config with defaults', async () => {
    await fs.writeFile(configPath, JSON.stringify({ gitEnabled: true }))
    const config = await loadConfig()
    expect(config.gitEnabled).toBe(true)
    expect(config.decksDir).toBe('./decks')
    expect(config.gitAutoCommit).toBe(false)
  })
})
