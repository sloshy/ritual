import path from 'node:path'
import { ArchidektClient } from '../../clients/ArchidektClient'
import { fetchMtgGoldfishDeck } from '../../importers/mtggoldfish'
import { fetchMoxfieldDeck } from '../../importers/moxfield-lib'
import { importFromTextFile } from '../../importers/text-file'
import { saveDeck } from '../../commands/import'
import { sanitizeDeckFileName } from '../../utils'
import { loadConfig } from '../config'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { apiHandler } from '../utils'
import type { DeckData } from '../../types'
import { getBaseDir } from '../../base-dir'

interface ImportDeckRequest {
  source: string
  overwrite?: boolean
}

interface ImportDeckResponse {
  success: boolean
  message: string
  deckName?: string
}

export function handleImportDeck(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const body = (await req.json()) as ImportDeckRequest
    const { source, overwrite = false } = body

    if (!source) {
      const resp: ImportDeckResponse = { success: false, message: 'source is required' }
      return Response.json(resp, { status: 400 })
    }

    let deckData: DeckData | undefined

    if (source.startsWith('https://')) {
      const archidektMatch = source.match(/archidekt\.com\/decks\/(\d+)/)
      if (archidektMatch?.[1]) {
        deckData = await new ArchidektClient().fetchDeck(archidektMatch[1])
      } else {
        const moxfieldMatch = source.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/)
        if (moxfieldMatch?.[1]) {
          deckData = await fetchMoxfieldDeck(moxfieldMatch[1])
        } else if (source.includes('mtggoldfish.com')) {
          deckData = await fetchMtgGoldfishDeck(source)
        } else {
          const resp: ImportDeckResponse = {
            success: false,
            message: 'URL not supported. Use Archidekt, Moxfield, or MTGGoldfish URLs.',
          }
          return Response.json(resp, { status: 400 })
        }
      }
    } else {
      deckData = await importFromTextFile(source)
    }

    if (!deckData) {
      const resp: ImportDeckResponse = { success: false, message: 'Failed to parse deck data' }
      return Response.json(resp, { status: 500 })
    }

    const decksDir = path.join(getBaseDir(), 'decks')
    await saveDeck(deckData, decksDir, {
      forceOverwrite: overwrite,
      nonInteractive: true,
      assumeYes: overwrite,
    })

    const config = await loadConfig()
    const safeName = sanitizeDeckFileName(deckData.name)
    const filePath = path.join(decksDir, `${safeName}.md`)

    if (shouldAutoCommit(config, decksDir)) {
      commitFiles([filePath], `Import deck: ${deckData.name}`)
      if (shouldAutoPush(config, decksDir)) {
        pushChanges(decksDir)
      }
    }

    const resp: ImportDeckResponse = {
      success: true,
      message: `Successfully imported '${deckData.name}'`,
      deckName: deckData.name,
    }
    return Response.json(resp)
  })
}
