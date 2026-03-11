import fs from 'node:fs/promises'
import path from 'node:path'
import { adminUserExists, isTotpEnabled } from '../auth'
import { parseDeckFrontMatter } from '../../deck-file'

interface StatusResponse {
  ok: boolean
  setupRequired: boolean
  totpEnabled: boolean
}

export async function handleStatus(): Promise<Response> {
  const setupRequired = !(await adminUserExists())
  const totpEnabled = setupRequired ? false : await isTotpEnabled()
  const body: StatusResponse = { ok: true, setupRequired, totpEnabled }
  return Response.json(body)
}

type DeckListItem = { slug: string; name: string }

interface DecksListResponse {
  decks: DeckListItem[]
}

export async function handleListDecks(): Promise<Response> {
  const decksDir = path.join(process.cwd(), 'decks')
  try {
    const files = await fs.readdir(decksDir)
    const deckFiles = files.filter(
      (f) => f.endsWith('.md') && !f.endsWith('.changes.md') && !f.endsWith('.primer.md'),
    )
    const decks = await Promise.all(
      deckFiles.map(async (f) => {
        const slug = f.replace(/\.md$/, '')
        try {
          const frontMatter = await parseDeckFrontMatter(path.join(decksDir, f))
          const name = typeof frontMatter['name'] === 'string' ? frontMatter['name'] : slug
          return { slug, name }
        } catch {
          return { slug, name: slug }
        }
      }),
    )
    const body: DecksListResponse = { decks }
    return Response.json(body)
  } catch {
    const body: DecksListResponse = { decks: [] }
    return Response.json(body)
  }
}
