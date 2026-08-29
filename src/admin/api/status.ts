import fs from 'node:fs/promises'
import path from 'node:path'
import { adminUserExists, isTotpEnabled } from '../auth'
import { readDeckName } from '../../importers/text-file'
import { getDecksDir, getSiteSellMode, loadRitualConfig } from '../../config/ritual-config'
import { isListMarkdownFile } from '../../list/list-file-name'

/**
 * `GET /api/status` — what a client needs before it has a session: whether this
 * server still needs its first account, which second factor to ask for, and
 * which optional capabilities it offers.
 */
export interface StatusResponse {
  ok: boolean
  setupRequired: boolean
  totpEnabled: boolean
  /**
   * Whether this server answers the sell/buylist routes at all. The *effective*
   * value, so a `ritual admin --sell-mode` run reports enabled even with no
   * `site.sellMode` in the config file. Clients hide their sell surfaces when
   * this is false — those routes 404 (see `withBuylistFeedGate`), and a toggle
   * that only ever produces a 404 is worse than no toggle.
   */
  sellMode: boolean
}

export async function handleStatus(): Promise<Response> {
  const setupRequired = !(await adminUserExists())
  const totpEnabled = setupRequired ? false : await isTotpEnabled()
  // Read from disk per request, exactly like `withBuylistFeedGate` — not from the
  // process-wide config cache. The two must never disagree: a client that keeps
  // its sell surfaces because this said yes, against routes that 404 because
  // the gate re-read the file, is worse than either answer on its own.
  const config = await loadRitualConfig()
  const body: StatusResponse = {
    ok: true,
    setupRequired,
    totpEnabled,
    sellMode: getSiteSellMode(config),
  }
  return Response.json(body)
}

type DeckListItem = { slug: string; name: string }

interface DecksListResponse {
  decks: DeckListItem[]
}

export async function handleListDecks(): Promise<Response> {
  const decksDir = getDecksDir()
  try {
    const files = await fs.readdir(decksDir)
    const deckFiles = files.filter(isListMarkdownFile)
    const decks = await Promise.all(
      deckFiles.map(async (f) => {
        const slug = f.replace(/\.md$/, '')
        try {
          return { slug, name: await readDeckName(path.join(decksDir, f)) }
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
