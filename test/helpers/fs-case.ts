import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Whether the temp directory's file system ignores case (APFS on macOS, NTFS on
 * Windows): there `a.md` and `A.md` are one file, so a fixture that needs both
 * cannot be built. Probed once, at import.
 */
export const CASE_INSENSITIVE_FS: boolean = (() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ritual-case-probe-'))
  try {
    writeFileSync(path.join(dir, 'probe'), '')
    return existsSync(path.join(dir, 'PROBE'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})()
