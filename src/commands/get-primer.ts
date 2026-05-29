import { Command } from 'commander'
import { importFromTextFile } from '../importers/text-file'
import { MoxfieldClient } from '../importers/moxfield-client'
import { parseMoxfieldPrimer } from '../primer-parser'
import { ExitCode } from './scripting'
import { getLogger } from '../logger'
import { resolveMoxfieldUserAgent } from '../importers/url-dispatch'
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
      const moxfieldMatch = source.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/)
      if (moxfieldMatch?.[1]) {
        const deckId = moxfieldMatch[1]
        const userAgent = resolveMoxfieldUserAgent(options.moxfieldUserAgent)
        if (!userAgent) {
          logger.error(
            'Error: Moxfield URL sources require a unique Moxfield-approved user agent string. Set MOXFIELD_USER_AGENT or pass --moxfield-user-agent <agent>.',
          )
          process.exitCode = ExitCode.UsageError
          return
        }

        const savedUserAgent = process.env.MOXFIELD_USER_AGENT
        process.env.MOXFIELD_USER_AGENT = userAgent
        try {
          const client = new MoxfieldClient()
          const deck = await client.fetchDeck(deckId)
          const primer = await client.fetchPrimer(deck.id ?? deckId)
          const rawText = primer?.content ?? deck.primer ?? deck.description
          if (!rawText) {
            logger.error('No primer found for this deck.')
            process.exitCode = ExitCode.RuntimeError
            return
          }
          const { markdown } = parseMoxfieldPrimer(rawText)
          process.stdout.write(markdown + '\n')
        } finally {
          if (savedUserAgent === undefined) {
            delete process.env.MOXFIELD_USER_AGENT
          } else {
            process.env.MOXFIELD_USER_AGENT = savedUserAgent
          }
        }
        return
      }

      // Local deck file path
      const resolved = await resolveList(source, 'deck')
      if (isResolveListError(resolved)) {
        logger.error(formatResolveListError(resolved))
        process.exitCode = resolved.kind === 'ambiguous' ? ExitCode.UsageError : ExitCode.NotFound
        return
      }

      let deckData: DeckData
      try {
        deckData = await importFromTextFile(resolved.filePath)
      } catch (e) {
        logger.error(`Failed to read deck file '${resolved.name}.md':`, e)
        process.exitCode = ExitCode.RuntimeError
        return
      }

      const primerText = deckData.primer
      if (!primerText) {
        logger.error(`Deck '${deckData.name}' has no primer field.`)
        process.exitCode = ExitCode.RuntimeError
        return
      }

      // The primer stored in the file is already parsed Markdown — output directly.
      process.stdout.write(primerText + '\n')
    })
}
