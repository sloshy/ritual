/**
 * "Are these two paths the same file?" — the one check every rename path uses
 * before deciding that an occupied destination is a collision.
 *
 * On a case-insensitive file system (macOS and Windows by default), renaming
 * `burn.md` to `Burn.md` produces a destination path that differs as a *string*
 * while pointing at the source file itself. Comparing device + inode is what
 * separates "the destination is this very file" from "another list already
 * lives there", so a capitalization fix is not reported as a collision.
 */

import fs from 'node:fs/promises'

/** The identity check {@link isSameFile} performs, injectable for tests. */
export type SameFileCheck = (a: string, b: string) => Promise<boolean>

/**
 * True when both paths resolve to the same underlying file. A missing file on
 * either side is `false` — nothing to collide with.
 *
 * An inode of `0` means "not reported", which some Windows volumes and network
 * shares do — exactly the platforms this check exists for. It must never be read
 * as identity, or two distinct lists would compare equal and a rename would
 * overwrite one with the other.
 */
export const isSameFile: SameFileCheck = async (a, b) => {
  try {
    const [statA, statB] = await Promise.all([fs.stat(a), fs.stat(b)])
    if (statA.ino === 0 || statB.ino === 0) return false
    return statA.ino === statB.ino && statA.dev === statB.dev
  } catch {
    return false
  }
}
