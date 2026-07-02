import { Command } from 'commander'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from '../base-dir'
import { getCollectionsDir, getDecksDir, getWantedDir } from '../ritual-config'
import { importFromTextFile, listDeckFiles } from '../importers/text-file'
import { parseCollectionFile } from '../collection-file'
import { parseWantedListFile } from './wanted-helpers'

export type UniqueCardEntry = {
  name: string
  set?: string
  collectorNumber?: string
}

const DEFAULT_OUTPUT_FILE = 'all-cards.md'

function entryKey(entry: UniqueCardEntry): string {
  return `${entry.name}|${entry.set ?? ''}|${entry.collectorNumber ?? ''}`
}

function compareEntries(a: UniqueCardEntry, b: UniqueCardEntry): number {
  const nameCmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en')
  if (nameCmp !== 0) return nameCmp
  const setCmp = (a.set ?? '').localeCompare(b.set ?? '', 'en')
  if (setCmp !== 0) return setCmp
  return (a.collectorNumber ?? '').localeCompare(b.collectorNumber ?? '', 'en', { numeric: true })
}

async function readMarkdownFiles(dir: string): Promise<string[]> {
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return []
  }
  return files.filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))
}

async function collectFromDecks(dir: string, seen: Map<string, UniqueCardEntry>): Promise<void> {
  let files: string[]
  try {
    files = await listDeckFiles(dir)
  } catch {
    return
  }
  for (const fileName of files) {
    const filePath = path.join(dir, fileName)
    const deck = await importFromTextFile(filePath).catch(() => null)
    if (!deck) continue
    for (const section of deck.sections) {
      for (const card of section.cards) {
        const entry: UniqueCardEntry = {
          name: card.name,
          set: card.set?.toLowerCase(),
          collectorNumber: card.collectorNumber,
        }
        seen.set(entryKey(entry), entry)
      }
    }
  }
}

async function collectFromCollections(
  dir: string,
  seen: Map<string, UniqueCardEntry>,
): Promise<void> {
  for (const fileName of await readMarkdownFiles(dir)) {
    const content = await fs.readFile(path.join(dir, fileName), 'utf-8').catch(() => '')
    const { entries } = parseCollectionFile(content)
    for (const e of entries) {
      const entry: UniqueCardEntry = {
        name: e.name,
        set: e.set.toLowerCase(),
        collectorNumber: e.collectorNumber,
      }
      seen.set(entryKey(entry), entry)
    }
  }
}

async function collectFromWanted(dir: string, seen: Map<string, UniqueCardEntry>): Promise<void> {
  for (const fileName of await readMarkdownFiles(dir)) {
    const content = await fs.readFile(path.join(dir, fileName), 'utf-8').catch(() => '')
    const { entries } = parseWantedListFile(content)
    for (const e of entries) {
      const entry: UniqueCardEntry = {
        name: e.name,
        set: e.set?.toLowerCase(),
        collectorNumber: e.collectorNumber,
      }
      seen.set(entryKey(entry), entry)
    }
  }
}

export async function collectAllCards(): Promise<UniqueCardEntry[]> {
  const seen = new Map<string, UniqueCardEntry>()
  await collectFromDecks(getDecksDir(), seen)
  await collectFromCollections(getCollectionsDir(), seen)
  await collectFromWanted(getWantedDir(), seen)
  return Array.from(seen.values()).sort(compareEntries)
}

export function formatAllCardsFile(entries: UniqueCardEntry[]): string {
  const lines: string[] = ['# All cards', '']
  for (const entry of entries) {
    if (entry.set && entry.collectorNumber) {
      lines.push(`- ${entry.name} (${entry.set.toUpperCase()}:${entry.collectorNumber})`)
    } else {
      lines.push(`- ${entry.name}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

type ListAllCardsOptions = {
  output: string
}

export function registerListAllCardsCommand(program: Command): void {
  program
    .command('list-all-cards')
    .description(
      'Write a manifest of every unique card across decks, collections, and wanted lists. Useful as a deterministic cache key for CI builds.',
    )
    .option('-o, --output <file>', 'Output file path (relative to base dir)', DEFAULT_OUTPUT_FILE)
    .action(async (options: ListAllCardsOptions) => {
      const entries = await collectAllCards()
      const content = formatAllCardsFile(entries)
      const outputPath = path.isAbsolute(options.output)
        ? options.output
        : path.join(getBaseDir(), options.output)
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, content, 'utf-8')
      console.log(`Wrote ${entries.length} cards to ${outputPath}`)
    })
}
