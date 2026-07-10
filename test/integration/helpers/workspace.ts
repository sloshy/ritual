import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { getBaseDir, setBaseDir } from '../../../src/base-dir'
import { initRitualConfig, resetRitualConfigCache } from '../../../src/ritual-config'
import { serializeDeckToMarkdown, type DeckFrontMatter } from '../../../src/deck-file'
import { serializeSectionedList } from '../../../src/section-format'
import { formatCollectionLine, formatWantedListLine } from '../../../src/card-line'
import {
  DEFAULT_SECTION,
  type Card,
  type Condition,
  type DeckSection,
  type Finish,
} from '../../../src/types'

/**
 * Shared temp-workspace setup and list-file fixture builders for the
 * integration suite. The fixture builders serialize through the real
 * serializers in src (deck-file / section-format / card-line), so a change to
 * the canonical card-line format can never leave test fixtures behind. Tests
 * that pin the *parsing* of specific raw markdown should keep their literals
 * inline instead of using these builders.
 */

/** The standard list subdirectories, matching the default ritual.config.json. */
const STANDARD_DIRS = ['decks', 'collections', 'wanted']

const STANDARD_CONFIG = {
  decksDir: './decks',
  collectionsDir: './collections',
  wantedDir: './wanted',
}

export type WorkspaceOptions = {
  /** Subdirectories to create. Defaults to decks/collections/wanted; pass [] to create none. */
  dirs?: string[]
  /**
   * Keys merged over the standard ritual.config.json before writing it, or
   * `false` to not write a config file at all. Defaults to the standard config.
   */
  config?: Record<string, unknown> | false
}

/** Write `dir`'s ritual.config.json: the standard list dirs plus `extra` keys merged over them. */
export async function writeConfig(dir: string, extra: Record<string, unknown> = {}): Promise<void> {
  await fs.writeFile(
    path.join(dir, 'ritual.config.json'),
    JSON.stringify({ ...STANDARD_CONFIG, ...extra }),
  )
}

/** Create a fresh temp workspace: list subdirectories plus a ritual.config.json. */
export async function createWorkspace(options: WorkspaceOptions = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-it-'))
  for (const sub of options.dirs ?? STANDARD_DIRS) {
    await fs.mkdir(path.join(dir, sub), { recursive: true })
  }
  if (options.config !== false) await writeConfig(dir, options.config)
  return dir
}

export async function removeWorkspace(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
}

/** Create a workspace scoped to `run`, removing it afterwards. */
export async function withWorkspace(
  run: (dir: string) => Promise<void>,
  options: WorkspaceOptions = {},
): Promise<void> {
  const dir = await createWorkspace(options)
  try {
    await run(dir)
  } finally {
    await removeWorkspace(dir)
  }
}

export type BoundWorkspaceOptions = WorkspaceOptions & {
  /** Also initRitualConfig() after switching, for code that reads the sync config getters. */
  init?: boolean
}

export type BoundWorkspace = {
  dir: string
  /** Restore the previous base dir, reset the config cache, and delete the workspace. */
  dispose: () => Promise<void>
}

/**
 * Create a workspace and point the in-process base dir at it, for tests that
 * drive admin handlers or command helpers directly instead of spawning the CLI.
 */
export async function bindWorkspace(options: BoundWorkspaceOptions = {}): Promise<BoundWorkspace> {
  const originalBase = getBaseDir()
  const dir = await createWorkspace(options)
  setBaseDir(dir)
  resetRitualConfigCache()
  if (options.init) await initRitualConfig()
  return {
    dir,
    dispose: async (): Promise<void> => {
      setBaseDir(originalBase)
      resetRitualConfigCache()
      await removeWorkspace(dir)
    },
  }
}

/** Initialize `dir` as a git repo with a test identity (for auto-commit tests). */
export function initGitRepo(dir: string): void {
  execSync('git init -q', { cwd: dir })
  execSync('git config user.email test@example.com', { cwd: dir })
  execSync('git config user.name "Ritual Test"', { cwd: dir })
  execSync('git config commit.gpgsign false', { cwd: dir })
}

// ── List-file fixtures ─────────────────────────────────────────────────────────

/**
 * A deck fixture: front matter plus either full sections or a single-`Main` card
 * list. Card `set` codes must be lowercase (the internal representation).
 */
export type DeckFixture = {
  frontMatter?: DeckFrontMatter
  sections?: DeckSection[]
  /** Shorthand for a lone `## Main` section. Ignored when `sections` is given. */
  cards?: Card[]
}

/** The canonical markdown for a deck fixture, via the real deck serializer. */
export function deckMarkdown(fixture: DeckFixture): string {
  const sections = fixture.sections ?? [{ name: DEFAULT_SECTION, cards: fixture.cards ?? [] }]
  const name = typeof fixture.frontMatter?.name === 'string' ? fixture.frontMatter.name : ''
  return serializeDeckToMarkdown({ name, sections }, fixture.frontMatter ?? {})
}

/** Write `<dir>/decks/<fileName>.md` from a deck fixture; returns the file path. */
export async function writeDeckFile(
  dir: string,
  fileName: string,
  fixture: DeckFixture,
): Promise<string> {
  return writeListFile(path.join(dir, 'decks', `${fileName}.md`), deckMarkdown(fixture))
}

/** One collection card line; finish defaults to nonfoil and section to Main. */
export type CollectionFixtureEntry = {
  name: string
  /** Set code, lowercase (e.g. `lea`) — the internal representation. */
  set: string
  collectorNumber: string
  finish?: Finish
  condition?: Condition
  note?: string
  cardId?: number
  section?: string
}

export type CollectionFixture = {
  /** The `# Title` heading; defaults to the file name. */
  title?: string
  entries: CollectionFixtureEntry[]
  sectionOrder?: string[]
}

/** The canonical markdown for a collection fixture, via the real line serializer. */
export function collectionMarkdown(fixture: CollectionFixture & { title: string }): string {
  return serializeSectionedList(
    fixture.title,
    fixture.entries.map(sectioned),
    fixture.sectionOrder ?? [],
    (entry) =>
      formatCollectionLine(
        entry.name,
        entry.set,
        entry.collectorNumber,
        entry.finish ?? 'nonfoil',
        entry.condition,
        entry.note,
        entry.cardId,
      ),
  )
}

/** Write `<dir>/collections/<fileName>.md` from a collection fixture; returns the file path. */
export async function writeCollectionFile(
  dir: string,
  fileName: string,
  fixture: CollectionFixture,
): Promise<string> {
  const filePath = path.join(dir, 'collections', `${fileName}.md`)
  return writeListFile(
    filePath,
    collectionMarkdown({ ...fixture, title: fixture.title ?? fileName }),
  )
}

/** One wanted-list card line; may be name-only, and never carries a condition. */
export type WantedFixtureEntry = {
  name: string
  /** Set code, lowercase (e.g. `lea`) — the internal representation. */
  set?: string
  collectorNumber?: string
  finish?: Finish
  note?: string
  cardId?: number
  section?: string
}

export type WantedFixture = {
  /** The `# Title` heading; defaults to the file name. */
  title?: string
  entries: WantedFixtureEntry[]
  sectionOrder?: string[]
}

/** The canonical markdown for a wanted-list fixture, via the real line serializer. */
export function wantedMarkdown(fixture: WantedFixture & { title: string }): string {
  return serializeSectionedList(
    fixture.title,
    fixture.entries.map(sectioned),
    fixture.sectionOrder ?? [],
    (entry) =>
      formatWantedListLine(
        entry.name,
        entry.set && entry.collectorNumber
          ? { set: entry.set, collectorNumber: entry.collectorNumber }
          : undefined,
        entry.finish,
        entry.note,
        entry.cardId,
      ),
  )
}

/** Write `<dir>/wanted/<fileName>.md` from a wanted-list fixture; returns the file path. */
export async function writeWantedFile(
  dir: string,
  fileName: string,
  fixture: WantedFixture,
): Promise<string> {
  const filePath = path.join(dir, 'wanted', `${fileName}.md`)
  return writeListFile(filePath, wantedMarkdown({ ...fixture, title: fixture.title ?? fileName }))
}

/** An entry with its section defaulted, ready for the sectioned-list serializer. */
type SectionedEntry<E> = E & { section: string }

function sectioned<E extends { section?: string }>(entry: E): SectionedEntry<E> {
  return { ...entry, section: entry.section ?? DEFAULT_SECTION }
}

async function writeListFile(filePath: string, content: string): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content)
  return filePath
}
