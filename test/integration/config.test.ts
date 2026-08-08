import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli, withTempDir } from './helpers/cli'

type ConfigFile = {
  decksDir?: string
  cacheFeedUrl?: string
  admin?: Record<string, unknown>
}

async function readConfigFile(dir: string): Promise<ConfigFile> {
  const content = await fs.readFile(path.join(dir, 'ritual.config.json'), 'utf-8')
  return JSON.parse(content) as ConfigFile
}

describe('config CLI (Integration)', () => {
  test('set round-trips through the config file and get reads it back', async () => {
    await withTempDir(async (dir) => {
      const set = await runCli(['config', 'set', 'decksDir', './my-decks'], dir)
      expect(set.exitCode).toBe(0)
      expect(set.stdout).toContain('Set decksDir = ./my-decks')

      const onDisk = await readConfigFile(dir)
      expect(onDisk.decksDir).toBe('./my-decks')

      const get = await runCli(['config', 'get', 'decksDir'], dir)
      expect(get.exitCode).toBe(0)
      expect(get.stdout.trim()).toBe('./my-decks')
    })
  })

  test('get reports not_found for an optional key that is unset', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['config', 'get', 'cacheFeedUrl', '--output', 'json'], dir)
      expect(result.exitCode).toBe(3)
      expect(result.stdout).toBe('')
      const errorJson = JSON.parse(result.stderr) as { error: { code: string; message: string } }
      expect(errorJson.error.code).toBe('not_found')
      expect(errorJson.error.message).toContain('cacheFeedUrl')
    })
  })

  test('get rejects an unknown property with a usage error listing available keys', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['config', 'get', 'nope'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Unknown property')
      expect(result.stderr).toContain('decksDir')
    })
  })

  test('unset on an optional key removes it and get reports not_found again', async () => {
    await withTempDir(async (dir) => {
      const url = 'https://feed.example/feed.json'
      const set = await runCli(['config', 'set', 'cacheFeedUrl', url], dir)
      expect(set.exitCode).toBe(0)

      const getAfterSet = await runCli(['config', 'get', 'cacheFeedUrl'], dir)
      expect(getAfterSet.exitCode).toBe(0)
      expect(getAfterSet.stdout.trim()).toBe(url)

      const unset = await runCli(['config', 'unset', 'cacheFeedUrl'], dir)
      expect(unset.exitCode).toBe(0)
      expect(unset.stdout).toContain('Unset cacheFeedUrl')

      const onDisk = await readConfigFile(dir)
      expect('cacheFeedUrl' in onDisk).toBeFalse()

      const getAfterUnset = await runCli(['config', 'get', 'cacheFeedUrl'], dir)
      expect(getAfterUnset.exitCode).toBe(3)
    })
  })

  test('unset reverts a defaulted key to its default and stays idempotent', async () => {
    await withTempDir(async (dir) => {
      const set = await runCli(['config', 'set', 'decksDir', './custom-decks'], dir)
      expect(set.exitCode).toBe(0)

      const unset = await runCli(['config', 'unset', 'decksDir'], dir)
      expect(unset.exitCode).toBe(0)
      expect(unset.stdout).toContain('Reset decksDir to default (./decks)')

      const get = await runCli(['config', 'get', 'decksDir'], dir)
      expect(get.exitCode).toBe(0)
      expect(get.stdout.trim()).toBe('./decks')

      // Unsetting an already-default key succeeds with the same message.
      const again = await runCli(['config', 'unset', 'decksDir'], dir)
      expect(again.exitCode).toBe(0)
      expect(again.stdout).toContain('Reset decksDir to default (./decks)')
    })
  })

  test('unset refuses the init-site-managed site deployment keys', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['config', 'unset', 'site.ciSystem'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('init-site')
    })
  })

  test('list --output json emits the effective config object', async () => {
    await withTempDir(async (dir) => {
      const set = await runCli(['config', 'set', 'defaultCurrency', 'eur'], dir)
      expect(set.exitCode).toBe(0)

      const result = await runCli(['config', 'list', '--output', 'json'], dir)
      expect(result.exitCode).toBe(0)

      // Matches the `config` field of the admin server's GET /api/config: the
      // full effective config with defaults materialized. (Only a *running*
      // server can also report `overrides` — a CLI process has no session
      // override to report.)
      const config = JSON.parse(result.stdout) as {
        decksDir: string
        defaultCurrency: string
        cacheSource: string
        admin: { rateLimitEnabled: boolean }
      }
      expect(config.decksDir).toBe('./decks')
      expect(config.defaultCurrency).toBe('eur')
      expect(config.cacheSource).toBe('scryfall')
      expect(config.admin.rateLimitEnabled).toBe(true)
    })
  })

  test('list text output marks defaults by value equality, not disk presence', async () => {
    await withTempDir(async (dir) => {
      // Writing any key materializes all defaulted keys into the file — the
      // (default) marker must still appear for the untouched ones.
      const set = await runCli(['config', 'set', 'decksDir', './custom-decks'], dir)
      expect(set.exitCode).toBe(0)

      const result = await runCli(['config', 'list'], dir)
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.split('\n')
      expect(lines).toContain('decksDir = ./custom-decks')
      expect(lines).toContain('collectionsDir = ./collections (default)')
      expect(lines).toContain('cacheFeedUrl = (unset)')
    })
  })
})
