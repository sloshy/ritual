import { Command } from 'commander'
import { importFromTextFile } from '../importers/text-file'
import { MoxfieldClient } from '../importers/moxfield-client'
import { parseMoxfieldPrimer } from '../list/primer-parser'
import { classifyFileReadError, ExitCode, writeStdout } from './scripting'
import { getLogger } from '../util/logger'
import {
  matchDeckUrl,
  resolveMoxfieldUserAgent,
  withMoxfieldUserAgent,
} from '../importers/url-dispatch'
import type { DeckData } from '../list/deck'
import { formatResolveListError, isResolveListError, resolveList } from '../list/resolve-list'
import { t } from '../i18n/t'

type GetPrimerOptions = {
  moxfieldUserAgent?: string
}

export function registerGetPrimerCommand(program: Command): void {
  program
    .command('get-primer')
    .description(t('help.getPrimer.description'))
    .argument('<source>', t('help.getPrimer.source'))
    .option('--moxfield-user-agent <agent>', t('help.getPrimer.moxfieldUserAgent'))
    .action(async (source: string, options: GetPrimerOptions) => {
      const logger = getLogger()

      // Moxfield URL path
      const urlMatch = matchDeckUrl(source)
      if (urlMatch?.service === 'moxfield') {
        const deckId = urlMatch.deckId
        const userAgent = resolveMoxfieldUserAgent(options.moxfieldUserAgent)
        if (!userAgent) {
          logger.error(t('cli.getPrimer.userAgentRequired'))
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
            logger.error(t('cli.getPrimer.noPrimerFetched'))
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
        logger.error(t('cli.getPrimer.readFailed', { file: resolved.filePath }), e)
        process.exitCode = exitCode
        return
      }

      const primerText = deckData.primer
      if (!primerText) {
        // The primer lives in a `.primer.md` sidecar, not in the deck's
        // frontmatter — an absent one is a missing resource (exit 3).
        logger.error(t('cli.getPrimer.noPrimer', { name: deckData.name }))
        process.exitCode = ExitCode.NotFound
        return
      }

      // The primer stored in the file is already parsed Markdown — output directly.
      writeStdout(primerText + '\n')
    })
}
