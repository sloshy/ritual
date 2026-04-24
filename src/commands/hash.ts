import { Command } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from '../base-dir'
import { computeHash, saveHash } from '../content-hash'

type HashOptions = {
  dryRun?: boolean
}

type HashResult = {
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

async function runHash(options: HashOptions): Promise<void> {
  const baseDir = getBaseDir()
  const dryRun = options.dryRun ?? false

  const dirs = [
    path.join(baseDir, 'decks'),
    path.join(baseDir, 'collections'),
    path.join(baseDir, 'wanted'),
  ]

  let total = 0
  for (const dir of dirs) {
    const results = await hashListsInDir(dir, dryRun)
    for (const { file, hash } of results) {
      const rel = path.relative(baseDir, file)
      console.log(`${dryRun ? '[dry-run] ' : ''}${rel}: ${hash}`)
      total++
    }
  }

  if (total === 0) {
    console.log('No list files found.')
  } else if (!dryRun) {
    console.log(`\nHashed ${total} file${total === 1 ? '' : 's'}.`)
  } else {
    console.log(`\nWould hash ${total} file${total === 1 ? '' : 's'}.`)
  }
}

export function registerHashCommand(program: Command): void {
  program
    .command('hash')
    .description('Compute and save hashes for all deck, collection, and wanted list files')
    .option('--dry-run', 'Print computed hashes without writing .sha256 files')
    .action(async (options: HashOptions) => {
      await runHash(options)
    })
}
