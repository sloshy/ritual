import fs from 'node:fs/promises'

/**
 * The one place a list file's sidecar files are enumerated. A list `<name>.md`
 * may be accompanied by `<name>.md.sha256` (its content hash), `<name>.changes.md`
 * (its changelog), and — decks only — `<name>.primer.md` (its primer text). Every
 * surface that renames or moves a list derives the sidecar set from here, so a
 * future sidecar type cannot be silently left behind at one call site.
 */

/** The path of a list's `.changes.md` changelog sidecar. */
export function changelogSidecarPath(mdPath: string): string {
  return mdPath.replace(/\.md$/, '.changes.md')
}

/** The path of a deck's `.primer.md` primer sidecar. */
export function primerSidecarPath(mdPath: string): string {
  return mdPath.replace(/\.md$/, '.primer.md')
}

/** One sidecar move performed by {@link moveListSidecars}. */
export type SidecarMove = { from: string; to: string }

/**
 * Move the changelog and primer sidecars of `oldPath` (those that exist) to sit
 * beside `newPath`. Returns the moves performed so callers can track the touched
 * files (e.g. for a git auto-commit).
 *
 * The `.sha256` hash sidecar is deliberately not handled here: a caller that
 * rewrites content owns the hash through `writeFileWithHash`, and a caller that
 * moves the file byte-for-byte moves the still-valid hash itself via `hashPath`
 * from `content-hash`.
 */
export async function moveListSidecars(oldPath: string, newPath: string): Promise<SidecarMove[]> {
  const candidates: readonly SidecarMove[] = [
    { from: changelogSidecarPath(oldPath), to: changelogSidecarPath(newPath) },
    { from: primerSidecarPath(oldPath), to: primerSidecarPath(newPath) },
  ]
  const moves: SidecarMove[] = []
  for (const move of candidates) {
    if (await Bun.file(move.from).exists()) {
      await fs.rename(move.from, move.to)
      moves.push(move)
    }
  }
  return moves
}
