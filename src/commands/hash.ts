import { Command } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from '../base-dir'
import { computeHash, saveHash } from '../content-hash'
import {
  addDryRunOption,
  addScriptingOptions,
  emitOutput,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'
import { getCollectionsDir, getDecksDir, getWantedDir } from '../ritual-config'

type HashCommandOptions = {
  dryRun?: boolean
} & Partial<ScriptingOptions>

/** One hashed list file — also the `--output json`/`ndjson` payload entry. */
export type HashResult = {
  /** Absolute path of the hashed list file. */
  file: string
  hash: string
}

async function hashListsInDir(dir: string, dryRun: boolean): Promise<HashResult[]> {
  const results: HashResult[] = []
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return results
  }

  const mdFiles = files.filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))
  for (const file of mdFiles) {
    const filePath = path.join(dir, file)
    const content = await fs.readFile(filePath, 'utf-8')
    const hash = computeHash(content)
    if (!dryRun) {
      await saveHash(filePath, hash)
    }
    results.push({ file: filePath, hash })
  }
  return results
}

async function runHash(options: HashCommandOptions, scripting: ScriptingOptions): Promise<void> {
  const baseDir = getBaseDir()
  const dryRun = options.dryRun ?? false

  const dirs = [getDecksDir(), getCollectionsDir(), getWantedDir()]

  const results: HashResult[] = []
  for (const dir of dirs) {
    results.push(...(await hashListsInDir(dir, dryRun)))
  }

  if (scripting.output !== 'text') {
    emitOutput(results, scripting)
    return
  }

  if (scripting.quiet) return

  for (const { file, hash } of results) {
    const rel = path.relative(baseDir, file)
    console.log(`${dryRun ? '[dry-run] ' : ''}${rel}: ${hash}`)
  }

  if (results.length === 0) {
    console.log('No list files found.')
  } else if (!dryRun) {
    console.log(`\nHashed ${results.length} file${results.length === 1 ? '' : 's'}.`)
  } else {
    console.log(`\nWould hash ${results.length} file${results.length === 1 ? '' : 's'}.`)
  }
}

export function registerHashCommand(program: Command): void {
  addScriptingOptions(
    addDryRunOption(
      program
        .command('hash')
        .description('Compute and save hashes for all deck, collection, and wanted list files'),
      'Print computed hashes without writing .sha256 files',
    ),
  ).action(async (options: HashCommandOptions) => {
    await runHash(options, normalizeScriptingOptions(options))
  })
}
