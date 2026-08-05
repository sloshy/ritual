import { cardCache } from '../../cache'
import { extractChangelogCardNames, type ChangelogPage } from '../../changelog-parser'
import { extractPrimerCardNames } from '../../primer-parser'
import type { LoadedCollection } from './collection'
import type { LoadedDeck } from './deck'
import type { LoadedWanted } from './wanted'

/**
 * Every card name a loaded list mentions — the one definition of "which cards
 * does this list need data for".
 *
 * Three surfaces have to agree on this set or they misbehave in ways nothing
 * reports: `build-site` fetches it, `serve --api` warms the card cache for it,
 * and the live payload builders resolve exactly these names (from the cache
 * alone, with no Scryfall fallback). A name one of them forgets is a card the
 * site renders blank.
 *
 * The set is the union of the list's own entries and the card references in the
 * material rendered alongside them — a deck's primer, and every list kind's
 * changelog, both of which the detail builders resolve for real.
 */

/** Resolve a free-text card reference to the cache's canonical spelling of it. */
async function canonical(name: string): Promise<string> {
  return (await cardCache.resolveCardName(name.toLowerCase())) ?? name
}

/** Card names in a deck's sections, primer, and changelog. May repeat. */
export async function deckCardNames(loaded: LoadedDeck): Promise<string[]> {
  const names: string[] = []
  for (const section of loaded.data.sections) {
    for (const card of section.cards) names.push(card.name)
  }
  for (const name of extractPrimerCardNames(loaded.data.primer ?? '')) {
    names.push(await canonical(name))
  }
  names.push(...(await changelogNames(loaded.changelog)))
  return names
}

/** Card names in a collection's or wanted list's entries and changelog. May repeat. */
export async function flatListCardNames(
  loaded: LoadedCollection | LoadedWanted,
): Promise<string[]> {
  const names = loaded.entries.map((entry) => entry.name)
  names.push(...(await changelogNames(loaded.changelog)))
  return names
}

/** Canonicalized card names referenced by a list's change history. */
async function changelogNames(changelog: ChangelogPage[]): Promise<string[]> {
  const names: string[] = []
  for (const name of extractChangelogCardNames(changelog)) names.push(await canonical(name))
  return names
}
