import { Command } from 'commander'
import { searchCards, refreshTags } from '../scryfall'
import { refreshCardCache } from '../cache/refresh-source'
import { ExitCode } from './scripting'

export function registerCacheCommand(program: Command): void {
  const cache = program.command('cache').description('Manage card cache')

  cache
    .command('preload-set')
    .description('Download and cache all cards for a given set')
    .argument('<setCode>', 'Set code to preload (e.g. khm, lea)')
    .action(async (setCode: string) => {
      const normalizedSetCode = setCode.toLowerCase()
      console.log(`Preloading set '${normalizedSetCode.toUpperCase()}'...`)
      try {
        const query = `set:${normalizedSetCode}`
        const cards = await searchCards(query)
        console.log(
          `Successfully cached ${cards.length} cards for set '${normalizedSetCode.toUpperCase()}'`,
        )
      } catch (e) {
        console.error('Failed to preload set:', e instanceof Error ? e.message : e)
        process.exitCode = ExitCode.RuntimeError
      }
    })

  cache
    .command('preload-all')
    .description('Download and cache all Scryfall card data (bulk), including oracle and art tags')
    .action(async () => {
      await refreshCardCache()
    })

  cache
    .command('refresh-tags')
    .description(
      'Re-download oracle and art tag bulks and re-attach them to cached cards (no full card re-download)',
    )
    .action(async () => {
      await refreshTags()
    })
}
