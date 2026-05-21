import fs from 'node:fs/promises'
import path from 'node:path'
import { extractMarkdownTitle } from '../markdown-utils'
import { listDeckFiles, readDeckName } from '../importers/text-file'
import { filterByIncludeList, includesAllLists } from './list-selection'

type ResolvedSource = { basename: string; displayName: string }

/** Discover non-changelog markdown base names (without `.md`) in a directory. */
async function discoverMarkdownBasenames(dir: string): Promise<string[]> {
  const files = await fs.readdir(dir)
  return files
    .filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))
    .map((f) => f.slice(0, -3))
}

/**
 * Reduce discovered base names to those allowed by an `include*` selection,
 * matching each on its resolved display name. A wildcard selection returns every
 * base name unchanged; files that can't be read are skipped.
 */
async function keepIncluded(
  dir: string,
  basenames: string[],
  include: string[],
  displayNameOf: (filePath: string, basename: string) => Promise<string>,
): Promise<string[]> {
  if (includesAllLists(include)) {
    return basenames
  }
  const resolved: ResolvedSource[] = []
  for (const basename of basenames) {
    try {
      const displayName = await displayNameOf(path.join(dir, `${basename}.md`), basename)
      resolved.push({ basename, displayName })
    } catch {
      // Skip unreadable files — they can't be matched by display name.
    }
  }
  return filterByIncludeList(resolved, include, (e) => e.displayName).map((e) => e.basename)
}

/**
 * Deck base names to build, filtered by `includeDecks`. Decks are matched on
 * their display name (the `name:` frontmatter field, falling back to the file
 * base name).
 */
export async function resolveDeckSources(decksDir: string, include: string[]): Promise<string[]> {
  const files = await listDeckFiles(decksDir)
  const basenames = files.map((f) => f.slice(0, -3))
  return keepIncluded(decksDir, basenames, include, (filePath) => readDeckName(filePath))
}

/**
 * Collection/wanted-list base names to build, filtered by the given include
 * selection. Lists are matched on their display name (the `# Title` heading,
 * falling back to the file base name).
 */
export async function resolveListSources(dir: string, include: string[]): Promise<string[]> {
  const basenames = await discoverMarkdownBasenames(dir)
  return keepIncluded(dir, basenames, include, async (filePath, basename) => {
    const content = await fs.readFile(filePath, 'utf-8')
    return extractMarkdownTitle(content) ?? basename
  })
}
