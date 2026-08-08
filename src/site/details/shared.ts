import path from 'node:path'
import { compareData } from '../../i18n/collate'
import fs from 'node:fs/promises'
import {
  extractChangelogCardNames,
  parseChangelog,
  type ChangelogPage,
} from '../../changelog-parser'
import { computeRepresentativePrints } from '../../scryfall'
import { getErrorMessage } from '../../errors'
import { t } from '../../i18n/t'
import type { ScryfallCard } from '../../types'
import type { SiteDetailContext } from './types'

/**
 * Why a list file could not be read, as the `Failed to load <kind> '<name>':`
 * lead-in's reason. An absent file gets the friendly wording; everything else
 * (`EACCES`, `EISDIR`, `EIO`, a parse failure) reports what actually happened,
 * since telling a user their present-but-unreadable file is "not found" sends
 * them looking for the wrong problem.
 */
export function listReadErrorMessage(error: unknown, filePath: string): string {
  if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
    return t('site.detail.fileNotFound', { path: filePath })
  }
  return getErrorMessage(error)
}

/** URL-safe slug for a list's display name (also the detail JSON's basename). */
export function slugifyListName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** Printings sorted newest-first by release date (input is not mutated). */
export function sortPrintingsByRelease(printings: ScryfallCard[]): ScryfallCard[] {
  return [...printings].sort((a, b) => compareData(b.released_at ?? '', a.released_at ?? ''))
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
