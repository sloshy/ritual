import fs from 'node:fs/promises'
import path from 'node:path'
import { artSidecarPath } from './card-art'
import { categoriesHashPath, categoriesSidecarPath } from './card-categories-sidecar'
import { hashPath } from '../changes/content-hash'

/**
 * The one place a list file's sidecar files are enumerated. A list `<name>.md`
 * may be accompanied by `<name>.md.sha256` (its content hash), `<name>.changes.md`
 * (its changelog), `<name>.art.json` (its custom card art),
 * `<name>.categories.json` (its category vocabulary and assignments) with its
 * own `<name>.categories.json.sha256`, and — decks only —
 * `<name>.primer.md` (its primer text). Every surface that renames or moves a
 * list derives the sidecar set from here, so a future sidecar type cannot be
 * silently left behind at one call site.
 */

/**
 * The path of a list's `.changes.md` changelog sidecar. List files are always
 * lowercase `.md` (`isListMarkdownFile`); anything else is a caller bug, and
 * throwing beats silently handing back the list path as its own sidecar.
 */
export function changelogSidecarPath(mdPath: string): string {
  if (!mdPath.endsWith('.md')) throw new Error(`Not a list markdown path: ${mdPath}`)
  return mdPath.slice(0, -'.md'.length) + '.changes.md'
}

/** The path of a deck's `.primer.md` primer sidecar. */
export function primerSidecarPath(mdPath: string): string {
  return mdPath.replace(/\.md$/, '.primer.md')
}

/** One sidecar move performed by {@link moveListSidecars}. */
export type SidecarMove = { from: string; to: string }

/**
 * Move the changelog, primer, custom-art and categories sidecars of `oldPath`
 * (those that exist) to sit beside `newPath`. Returns the moves performed so
 * callers can track the touched files (e.g. for a git auto-commit).
 *
 * The list file's own `.sha256` hash sidecar is deliberately not handled here: a
 * caller that rewrites content owns the hash through `writeFileWithHash`, and a
 * caller that moves the file byte-for-byte moves the still-valid hash itself via
 * `hashPath` from `content-hash`. The *categories* sidecar's `.sha256` is a
 * different matter and does move: a rename never rewrites that file, so its hash
 * stays valid and must travel with it, or the next `detect-changes` would read
 * the sidecar as a hand edit.
 */
export async function moveListSidecars(oldPath: string, newPath: string): Promise<SidecarMove[]> {
  // Derived from the kinds table below rather than restated: this list is
  // exactly every kind except the list file's own `hash` (see above), so a new
  // sidecar kind is moved without touching this function.
  const candidates: readonly SidecarMove[] = LIST_SIDECAR_KINDS.filter(
    (kind) => kind !== 'hash',
  ).map((kind) => ({ from: listSidecarPath[kind](oldPath), to: listSidecarPath[kind](newPath) }))
  const moves: SidecarMove[] = []
  for (const move of candidates) {
    if (await Bun.file(move.from).exists()) {
      await fs.rename(move.from, move.to)
      moves.push(move)
    }
  }
  return moves
}

/**
 * Every kind of sidecar a list file can have, in the order a move walks them.
 * The array is the source of truth and the union is derived from it, so a new
 * kind cannot be added to the type yet left out of the moves — the `Record`
 * below then forces its path function to exist too.
 */
export const LIST_SIDECAR_KINDS = [
  'hash',
  'changelog',
  'primer',
  'art',
  'categories',
  'categoriesHash',
] as const

export type ListSidecarKind = (typeof LIST_SIDECAR_KINDS)[number]

/** Where each kind of sidecar lives, given the list's `.md` path. */
export const listSidecarPath: Record<ListSidecarKind, (mdPath: string) => string> = {
  hash: hashPath,
  changelog: changelogSidecarPath,
  primer: primerSidecarPath,
  art: artSidecarPath,
  categories: categoriesSidecarPath,
  categoriesHash: categoriesHashPath,
}

/** One sidecar move, tagged with which sidecar moved. */
export type KindedSidecarMove = SidecarMove & { kind: ListSidecarKind }

/**
 * Move a list file **and every sidecar it has**, including the `.sha256` — for a
 * pure path change that does not rewrite content, so the existing hash stays
 * valid and travels with the file. (Contrast {@link moveListSidecars}, for a
 * caller that rewrites content and therefore owns the hash itself.)
 *
 * The sidecars move first and the `.md` last, which makes the `.md` rename the
 * commit point: an interruption leaves the list readable at `oldPath` with some
 * sidecars parked at `newPath`, never the reverse — a list whose changelog
 * (the persisted `&N` card-change record) has been orphaned under a name the
 * list no longer has.
 *
 * Returns the sidecar kinds that existed and moved; the `.md` file itself always
 * moves, so it is not reported.
 */
export async function moveListFileAndSidecars(
  oldPath: string,
  newPath: string,
): Promise<ListSidecarKind[]> {
  const moved: ListSidecarKind[] = []
  for (const kind of LIST_SIDECAR_KINDS) {
    const from = listSidecarPath[kind](oldPath)
    if (await Bun.file(from).exists()) {
      await fs.rename(from, listSidecarPath[kind](newPath))
      moved.push(kind)
    }
  }
  await fs.rename(oldPath, newPath)
  return moved
}

/**
 * Move a list file and every sidecar it has from `from` to `to` **through a
 * temporary name**, for the case where the two paths name the *same* file — a
 * case-only rename on a case-insensitive file system, where a direct rename
 * would do nothing.
 *
 * Returns the moves in the caller's terms (where each sidecar started, where it
 * ended), tagged with their kind so the caller need not recover that by
 * comparing paths.
 *
 * A failure part-way is rolled back file by file from wherever each piece
 * currently sits, so a partial move cannot strand the changelog or primer under
 * the temporary name.
 */
export async function renameListThroughTemp(
  from: string,
  to: string,
): Promise<KindedSidecarMove[]> {
  const tempPath = path.join(
    path.dirname(to),
    `.ritual-rename-${Math.random().toString(36).slice(2, 10)}.md`,
  )
  const kinds = await moveListFileAndSidecars(from, tempPath)
  try {
    await moveListFileAndSidecars(tempPath, to)
  } catch (error) {
    await restoreListFileAndSidecars([tempPath, to], from)
    throw error
  }
  return kinds.map((kind) => ({
    kind,
    from: listSidecarPath[kind](from),
    to: listSidecarPath[kind](to),
  }))
}

/**
 * Best-effort rollback: for the list file and each sidecar, take whichever
 * staging path still holds it and put it back under `mdPath`. Per-file rather
 * than all-or-nothing, because a half-finished move leaves the pieces spread
 * across the staging paths.
 */
async function restoreListFileAndSidecars(
  stagedPaths: readonly string[],
  mdPath: string,
): Promise<void> {
  const restore = async (at: string, target: string): Promise<void> => {
    if (at === target) return
    if (await Bun.file(at).exists()) await fs.rename(at, target).catch(() => undefined)
  }
  for (const staged of stagedPaths) {
    for (const kind of LIST_SIDECAR_KINDS) {
      await restore(listSidecarPath[kind](staged), listSidecarPath[kind](mdPath))
    }
    await restore(staged, mdPath)
  }
}
