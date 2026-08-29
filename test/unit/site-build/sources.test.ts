import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveBuildSources } from '../../../src/site-build/sources'
import { defaultSiteSelection } from '../../../src/config/list-selection'
import { createWorkspace, removeWorkspace } from '../../helpers/workspace'
import { captureConsole } from '../../helpers/capture'

/**
 * The one reporting branch `list-sources`'s own tests cannot reach: a user-named
 * source that two files answer to is recorded as an explicit skip (which fails
 * the build) naming both, rather than resolved to an arbitrary winner.
 */
describe('resolveBuildSources', () => {
  test('a named deck two files share is an explicit, ambiguous skip naming both', async () => {
    const root = await createWorkspace({ dirs: [], config: false })
    try {
      // Captured only to keep the resolver's own chatter out of the run's output.
      await captureConsole(['log', 'error'], async () => {
        const decks = path.join(root, 'decks')
        await fs.mkdir(decks)
        await fs.writeFile(path.join(decks, 'burn-a.md'), '# Burn\n\n## Mainboard\n')
        await fs.writeFile(path.join(decks, 'burn-b.md'), '# Burn\n\n## Mainboard\n')

        const sources = await resolveBuildSources({
          named: { deck: ['Burn'], collection: undefined, wanted: undefined },
          dirs: {
            deck: decks,
            collection: path.join(root, 'collections'),
            wanted: path.join(root, 'wanted'),
          },
          selection: defaultSiteSelection(),
        })

        expect(sources.skipped).toHaveLength(1)
        const [skip] = sources.skipped
        expect(skip).toMatchObject({ kind: 'deck', name: 'Burn', explicit: true })
        // Both matches are display names, so the reason reads "Burn, Burn" — the
        // count is what tells the user there were two.
        expect(skip?.reason).toContain('2 decks')
        expect(skip?.reason).toContain('Burn, Burn')
        expect(sources.categories.deck.buildable).toEqual([])
        expect(sources.deckUrls).toEqual([])
      })
    } finally {
      await removeWorkspace(root)
    }
  })
})
