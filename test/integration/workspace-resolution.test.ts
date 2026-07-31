import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ExitCode } from '../../src/commands/scripting'
import { runCli, withTempDir } from './helpers/cli'
import { writeDeckFile } from './helpers/workspace'

/**
 * Which directory the CLI treats as the workspace, and what it is allowed to
 * write there. The root preAction hook resolves `--base-dir` / `RITUAL_BASE_DIR`
 * and refuses anything that is not an existing directory (a typo must not read
 * as an empty workspace), and merely *reading* config never materializes
 * `ritual.config.json` — only a genuine write does.
 */

/** A workspace directory under `parent` holding one deck, named after the deck. */
async function seedDeck(parent: string, name: string): Promise<string> {
  const dir = path.join(parent, name)
  await writeDeckFile(dir, name, { frontMatter: { name }, cards: [] })
  return dir
}

describe('base dir resolution (Integration)', () => {
  test('a base dir that does not exist is a usage error that creates nothing', async () => {
    await withTempDir(async (dir) => {
      const missing = path.join(dir, 'typo', 'deep')
      const result = await runCli(['--base-dir', missing, 'lists'], dir)

      expect(result.exitCode).toBe(ExitCode.UsageError)
      expect(result.stderr.trim()).toBe(`base directory does not exist: ${missing}`)
      expect(result.stdout).toBe('')
      expect(await fs.readdir(dir)).toEqual([])
    })
  })

  test('a base dir pointing at a regular file is a usage error', async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, 'notes.txt')
      await fs.writeFile(file, 'not a workspace')

      const result = await runCli(['--base-dir', file, 'lists'], dir)

      expect(result.exitCode).toBe(ExitCode.UsageError)
      expect(result.stderr.trim()).toBe(`base directory is not a directory: ${file}`)
    })
  })

  test('RITUAL_BASE_DIR selects the workspace, and --base-dir wins over it', async () => {
    await withTempDir(async (dir) => {
      const fromEnv = await seedDeck(dir, 'env-deck')
      const fromFlag = await seedDeck(dir, 'flag-deck')

      const viaEnv = await runCli(['lists'], dir, { RITUAL_BASE_DIR: fromEnv })
      expect(viaEnv.exitCode).toBe(0)
      expect(viaEnv.stdout).toContain('env-deck')

      const flagWins = await runCli(['--base-dir', fromFlag, 'lists'], dir, {
        RITUAL_BASE_DIR: fromEnv,
      })
      expect(flagWins.exitCode).toBe(0)
      expect(flagWins.stdout).toContain('flag-deck')
      expect(flagWins.stdout).not.toContain('env-deck')
    })
  })

  test('an invalid RITUAL_BASE_DIR is rejected like an invalid flag', async () => {
    await withTempDir(async (dir) => {
      const missing = path.join(dir, 'nope')
      const result = await runCli(['lists'], dir, { RITUAL_BASE_DIR: missing })

      expect(result.exitCode).toBe(ExitCode.UsageError)
      expect(result.stderr.trim()).toBe(`base directory does not exist: ${missing}`)
    })
  })
})

describe('config file materialization (Integration)', () => {
  test('a read command in a fresh directory writes nothing', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['lists'], dir)

      expect(result.exitCode).toBe(0)
      expect(await fs.readdir(dir)).toEqual([])
    })
  })

  test('config set materializes the file', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['config', 'set', 'defaultCurrency', 'eur'], dir)

      expect(result.exitCode).toBe(0)
      expect(await fs.readdir(dir)).toEqual(['ritual.config.json'])
    })
  })

  test('a malformed config file fails the command and is left untouched', async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, 'ritual.config.json')
      const original = '{\n  "decksDir": "./my-decks",\n  "defaultCurrency": "eur",\n'
      await fs.writeFile(configPath, original)

      const result = await runCli(['lists'], dir)

      expect(result.exitCode).toBe(ExitCode.RuntimeError)
      expect(result.stderr).toContain('ritual.config.json is not valid JSON')
      expect(result.stderr).toContain(configPath)
      expect(result.stderr).toContain('Fix the file')
      expect(await fs.readFile(configPath, 'utf-8')).toBe(original)
    })
  })

  // The guard is preAction's config load failing before the action runs, not a
  // check inside the writer itself — what matters is the file survives intact.
  test('a write command fails on a malformed config file without rewriting it', async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, 'ritual.config.json')
      const original = '{ "defaultCurrency": "eur" '
      await fs.writeFile(configPath, original)

      const result = await runCli(['config', 'set', 'defaultCurrency', 'usd'], dir)

      expect(result.exitCode).toBe(ExitCode.RuntimeError)
      expect(await fs.readFile(configPath, 'utf-8')).toBe(original)
    })
  })
})

describe('dry-run side effects (Integration)', () => {
  test('import --dry-run leaves a pristine directory untouched', async () => {
    await withTempDir(async (dir) => {
      const source = path.join(dir, 'decklist.txt')
      await fs.writeFile(source, '2 Mountain\n')

      const result = await runCli(
        ['import', source, '--type', 'deck', '--dry-run', '--no-input'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[dry-run]')
      expect(await fs.readdir(dir)).toEqual(['decklist.txt'])
    })
  })
})
