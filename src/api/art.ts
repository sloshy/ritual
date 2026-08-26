import path from 'node:path'
import { isArtImageExtension, type ArtImageExtension } from '../list/card-art'
import { getArtDir } from '../config/ritual-config'
import { isPathWithinDir } from '../util/path-validation'

/**
 * Serves the custom-art directory read-only at `/art/<relpath>` — the same path
 * a built site carries the copied files at, so a card's baked `customArt` value
 * resolves identically whether the page came from `dist/` or from a live
 * server.
 *
 * The art directory is user-owned and may hold anything, so only the image
 * extensions `card-art.ts` accepts are served: anything else is a 404 rather
 * than a file handed out with a guessed type. Keying the table by
 * {@link ArtImageExtension} is what keeps the two halves in step — an extension
 * added to the allowlist without a content type here is a compile error.
 */
const ART_ROUTE_PREFIX = '/art/'

const ART_CONTENT_TYPES: Record<ArtImageExtension, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

/** The art-dir-relative path a request asks for, or null when it cannot be one. */
export function parseArtRequestPath(pathname: string): string | null {
  if (!pathname.startsWith(ART_ROUTE_PREFIX)) return null
  const segments = pathname.slice(ART_ROUTE_PREFIX.length).split('/')
  const decoded: string[] = []
  for (const segment of segments) {
    if (segment === '') return null
    let value: string
    try {
      value = decodeURIComponent(segment)
    } catch {
      return null
    }
    // A decoded separator or traversal segment would escape the art directory
    // before `isPathWithinDir` ever sees it.
    if (value === '.' || value === '..' || value.includes('/') || value.includes('\\')) return null
    if (value.includes('\0')) return null
    decoded.push(value)
  }
  return decoded.join('/')
}

function notFound(): Response {
  return Response.json({ error: 'Not found' }, { status: 404 })
}

/** `GET /art/*` — one image from the configured art directory. */
export async function handleArtFile(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const relPath = parseArtRequestPath(url.pathname)
  if (relPath === null) return notFound()
  const extension = path.extname(relPath).toLowerCase()
  if (!isArtImageExtension(extension)) return notFound()
  const contentType = ART_CONTENT_TYPES[extension]

  // The cached config, like every other consumer of a configured directory: a
  // per-request re-read would put a file read in front of every image the page
  // asks for.
  const artDir = getArtDir()
  const filePath = path.join(artDir, relPath)
  if (!isPathWithinDir(filePath, artDir)) return notFound()

  const file = Bun.file(filePath)
  if (!(await file.exists())) return notFound()
  return new Response(file, { headers: { 'Content-Type': contentType } })
}
