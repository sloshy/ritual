import path from 'node:path'
import fs from 'node:fs/promises'
import {
  extractChangelogCardNames,
  parseChangelog,
  type ChangelogPage,
} from '../../changelog-parser'
import { computeRepresentativePrints } from '../../scryfall'
import type { ScryfallCard } from '../../types'
import type { SiteDetailContext } from './types'

/** URL-safe slug for a list's display name (also the detail JSON's basename). */
export function slugifyListName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** Printings sorted newest-first by release date (input is not mutated). */
export function sortPrintingsByRelease(printings: ScryfallCard[]): ScryfallCard[] {
  return [...printings].sort((a, b) => (b.released_at ?? '').localeCompare(a.released_at ?? ''))
}

export type ListSidecars = {
  changelog: ChangelogPage[]
  /** ISO mtime of the list file, or undefined when it can't be statted. */
  fileMtime?: string
}

/**
 * Read a list's optional `.changes.md` sidecar (absence is normal) and the list
 * file's mtime. Shared by all three list loaders.
 */
export async function loadListSidecars(
  dir: string,
  baseName: string,
  listFilePath: string,
): Promise<ListSidecars> {
  let changelog: ChangelogPage[] = []
  try {
    const changelogContent = await fs.readFile(path.join(dir, `${baseName}.changes.md`), 'utf-8')
    changelog = parseChangelog(changelogContent)
  } catch {
    // No changelog file, that's fine
  }

  let fileMtime: string | undefined
  try {
    const stat = await fs.stat(listFilePath)
    fileMtime = stat.mtime.toISOString()
  } catch {
    // The caller already loaded the list file; ignore stat errors.
  }

  return { changelog, fileMtime }
}

/**
 * Add changelog-referenced cards to a detail's card/printings maps so change
 * history card links resolve at runtime. Mutates `cardMap` and `printingsMap`.
 */
export async function includeChangelogCards(
  changelog: ChangelogPage[],
  cardMap: Record<string, ScryfallCard | null>,
  printingsMap: Record<string, ScryfallCard[]>,
  ctx: SiteDetailContext,
): Promise<void> {
  for (const clName of extractChangelogCardNames(changelog)) {
    const canonical = (await ctx.resolveCardName(clName.toLowerCase())) ?? clName
    if (!cardMap[canonical]) {
      // Find a representative card for this name
      const printingsForCard = await ctx.getPrintings(canonical)
      if (printingsForCard.length > 0) {
        if (!printingsMap[canonical]) {
          printingsMap[canonical] = printingsForCard
        }
        const sorted = sortPrintingsByRelease(printingsForCard)
        const repPrints = computeRepresentativePrints(
          sorted,
          sorted,
          ctx.availableCurrencies,
          ctx.bannedPrintings,
        )
        cardMap[canonical] = repPrints.usd?.representative ?? sorted[0]!
      }
    }
  }
}
