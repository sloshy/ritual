import { Command } from 'commander'
import { importFromTextFile } from '../importers/text-file'
import { MoxfieldClient } from '../importers/moxfield-client'
import { parseMoxfieldPrimer } from '../primer-parser'
import { classifyFileReadError, ExitCode, writeStdout } from './scripting'
import { getLogger } from '../logger'
import {
  matchDeckUrl,
  resolveMoxfieldUserAgent,
  withMoxfieldUserAgent,
} from '../importers/url-dispatch'
import type { DeckData } from '../types'
import { formatResolveListError, isResolveListError, resolveList } from '../resolve-list'

type GetPrimerOptions = {
  moxfieldUserAgent?: string
}

export function registerGetPrimerCommand(program: Command): void {
  program
    .command('get-primer')
    .description('Extract and output the primer for a deck as Markdown')
    .argument(
      '<source>',
      'Local deck name (e.g. winota-snowball-stax) or Moxfield URL to fetch from',
    )
    .option(
      '--moxfield-user-agent <agent>',
      'Moxfield-approved unique User-Agent string (required for Moxfield URL sources unless MOXFIELD_USER_AGENT is set)',
    )
    .action(async (source: string, options: GetPrimerOptions) => {
      const logger = getLogger()

      // Moxfield URL path
      const urlMatch = matchDeckUrl(source)
      if (urlMatch?.service === 'moxfield') {
        const deckId = urlMatch.deckId
        const userAgent = resolveMoxfieldUserAgent(options.moxfieldUserAgent)
        if (!userAgent) {
          logger.error(
            'Error: Moxfield URL sources require a unique Moxfield-approved user agent string. Set MOXFIELD_USER_AGENT or pass --moxfield-user-agent <agent>.',
          )
          process.exitCode = ExitCode.UsageError
          return
        }

        await withMoxfieldUserAgent(userAgent, async () => {
          const client = new MoxfieldClient()
          const deck = await client.fetchDeck(deckId)
          const primer = await client.fetchPrimer(deck.id ?? deckId)
          const rawText = primer?.content ?? deck.primer ?? deck.description
          if (!rawText) {
            // An absent primer is a missing resource, not a runtime failure.
            logger.error('No primer found for this deck.')
            process.exitCode = ExitCode.NotFound
            return
          }
          const { markdown } = parseMoxfieldPrimer(rawText)
          writeStdout(markdown + '\n')
        })
        return
      }

      // Local deck file path
      const resolved = await resolveList(source, 'deck')
      if (isResolveListError(resolved)) {
        logger.error(formatResolveListError(resolved, 'none'))
        process.exitCode = resolved.kind === 'ambiguous' ? ExitCode.UsageError : ExitCode.NotFound
        return
      }

      let deckData: DeckData
      try {
        deckData = await importFromTextFile(resolved.filePath)
      } catch (e) {
        // A deck file that vanished between resolution and read is a not-found;
        // a permission/IO failure stays a runtime error.
        const { exitCode } = classifyFileReadError(e)
        logger.error(`Failed to read deck file '${resolved.filePath}':`, e)
        process.exitCode = exitCode
        return
      }

      const primerText = deckData.primer
      if (!primerText) {
        // The primer lives in a `.primer.md` sidecar, not in the deck's
        // frontmatter — an absent one is a missing resource (exit 3).
        logger.error(`Deck '${deckData.name}' has no primer (.primer.md sidecar).`)
        process.exitCode = ExitCode.NotFound
        return
      }

      // The primer stored in the file is already parsed Markdown — output directly.
      writeStdout(primerText + '\n')
    })
}
