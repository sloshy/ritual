import fs from 'node:fs/promises'
import path from 'node:path'
import { cardArtFilePath, loadCardArt } from '../card-art'
import { SITE_ART_DIR } from './art-url'
import { getErrorMessage, hasErrorCode } from '../errors'

/**
 * Copies the local images a build's lists reference into the site tree.
 *
 * A `<list>.art.json` sidecar names its files by their art-dir-relative path,
 * and the built site serves them under that same path below `art/` — so two
 * lists pointing at one image copy it once, and `serve --api`'s `/art/*` route
 * (`src/api/art.ts`) answers for the identical URL without a build at all.
 *
 * The URL half of that agreement lives in `art-url.ts`, which the browser
 * bundles can import; this module is node-only.
 */

/** One image that made it into the build. */
export type DeployedArtFile = {
  /** Art-dir-relative path, the key both the copy and the baked URL are derived from. */
  relPath: string
  sourcePath: string
  destPath: string
}

/** A sidecar that could not be read, or a file that could not be read or copied. */
export type CardArtDeployWarning =
  | { kind: 'sidecar-unreadable'; listFilePath: string; message: string }
  | { kind: 'source-unreadable'; relPath: string; message: string }
  | { kind: 'copy-failed'; relPath: string; message: string }

export type CardArtDeployResult = {
  copied: DeployedArtFile[]
  /**
   * Referenced paths with no readable file in the art directory, deduplicated
   * like the copies. Reported as build warnings, and the reason the baker must
   * leave those cards' `customArt` out of the detail JSON.
   */
  missing: string[]
  warnings: CardArtDeployWarning[]
}

export type CardArtDeployOptions = {
  /** The `.md` paths of every list in the build; each may have an art sidecar. */
  listFilePaths: readonly string[]
  /** The configured art directory (`getArtDir()`). */
  artDir: string
  /** The scratch directory the site is being built into. */
  buildDir: string
}

/**
 * Whether the path names a regular file the build can copy.
 *
 * A stat that fails for any other reason (a permission denial, a dead symlink's
 * loop, an I/O error) is reported rather than thrown: one unreadable image must
 * not take the whole site build down with it, any more than one missing file
 * does. The card simply keeps its normal art, and the build says why.
 */
type ArtSourceCheck =
  | { kind: 'file' }
  | { kind: 'missing' }
  | { kind: 'unreadable'; message: string }

async function checkArtSource(filePath: string): Promise<ArtSourceCheck> {
  try {
    return (await fs.stat(filePath)).isFile() ? { kind: 'file' } : { kind: 'missing' }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')) return { kind: 'missing' }
    return { kind: 'unreadable', message: getErrorMessage(error) }
  }
}

/**
 * Copy every local image the build's lists reference into `<buildDir>/art/`.
 *
 * Sidecars are read without a card-id set: which cards still exist is the
 * detail builder's business, and a stale entry must not stop the file it points
 * at from being deployed for the lists that do use it.
 */
export async function deployCardArt(options: CardArtDeployOptions): Promise<CardArtDeployResult> {
  const { listFilePaths, artDir, buildDir } = options
  const copied: DeployedArtFile[] = []
  const missing: string[] = []
  const warnings: CardArtDeployWarning[] = []
  const seen = new Set<string>()

  for (const listFilePath of listFilePaths) {
    const loaded = await loadCardArt(listFilePath)
    if (!loaded.ok) {
      warnings.push({ kind: 'sidecar-unreadable', listFilePath, message: loaded.message })
      continue
    }
    for (const ref of loaded.art.values()) {
      if (!('file' in ref)) continue
      const relPath = ref.file
      if (seen.has(relPath)) continue
      seen.add(relPath)

      const sourcePath = cardArtFilePath(artDir, ref)
      const source = await checkArtSource(sourcePath)
      if (source.kind === 'missing') {
        missing.push(relPath)
        continue
      }
      if (source.kind === 'unreadable') {
        warnings.push({ kind: 'source-unreadable', relPath, message: source.message })
        continue
      }
      const destPath = path.join(buildDir, SITE_ART_DIR, ...relPath.split('/'))
      try {
        await fs.mkdir(path.dirname(destPath), { recursive: true })
        await fs.copyFile(sourcePath, destPath)
      } catch (error) {
        warnings.push({ kind: 'copy-failed', relPath, message: getErrorMessage(error) })
        continue
      }
      copied.push({ relPath, sourcePath, destPath })
    }
  }

  return { copied, missing, warnings }
}

/**
 * Every referenced path the build did **not** deploy: absent from the art
 * directory, unreadable, or copied unsuccessfully. The bakers must leave those
 * cards' `customArt` out of the detail JSON — a baked path with no file behind
 * it is a broken image where the card's normal art belonged.
 *
 * Each of these paths is already reported by exactly one warning (or by
 * `missing`), so a caller listing them does not warn again.
 */
export function undeployedArtFiles(result: CardArtDeployResult): Set<string> {
  const paths = new Set(result.missing)
  for (const warning of result.warnings) {
    if (warning.kind !== 'sidecar-unreadable') paths.add(warning.relPath)
  }
  return paths
}
