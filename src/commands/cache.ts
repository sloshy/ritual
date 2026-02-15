import { Command } from 'commander'
import { searchCards, preloadCache } from '../scryfall'

export function registerCacheCommand(program: Command) {
  const cache = program.command('cache').description('Manage card cache')

  cache
    .command('preload-set')
    .description('Download and cache all cards for a given set')
    .argument('<setCode>', 'Set code to preload (e.g. khm, lea)')
    .action(async (setCode: string) => {
      console.log(`Preloading set '${setCode}'...`)
      try {
        const query = `set:${setCode}`
        const cards = await searchCards(query)
        console.log(`Successfully cached ${cards.length} cards for set '${setCode}'`)
      } catch (e) {
        console.error('Failed to preload set:', e)
      }
    })

  cache
    .command('preload-all')
    .description('Download and cache all Scryfall card data (bulk)')
    .action(async () => {
      await preloadCache()
    })
}
