import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../../../src/cache'
import { getBaseDir, setBaseDir } from '../../../src/base-dir'
import type { CardKingdomProduct } from '../../../src/cardkingdom/feed'
import { makeCardKingdomCacheFile } from '../../test-utils'
import type { ScryfallCard } from '../../../src/types'

/**
 * Seed a workspace's card cache through the real writer, so its on-disk format
 * is never hand-built. The base dir is saved and restored around the write
 * (with the in-process memo invalidated), which is exactly the part that goes
 * subtly wrong when hand-copied per suite.
 */
export async function seedCardCache(
  dir: string,
  cards: Record<string, ScryfallCard[]>,
): Promise<void> {
  const originalBase = getBaseDir()
  setBaseDir(dir)
  try {
    await cardCache.bulkSet(cards)
  } finally {
    cardCache.invalidate?.()
    setBaseDir(originalBase)
  }
}

/** Write a synthetic Card Kingdom feed cache into `dir`'s cache directory. */
export async function seedCardKingdomFeed(
  dir: string,
  products: CardKingdomProduct[],
): Promise<void> {
  const file = makeCardKingdomCacheFile(products)
  await fs.mkdir(path.join(dir, 'cache'), { recursive: true })
  await fs.writeFile(path.join(dir, 'cache', 'cardkingdom.json'), JSON.stringify(file))
}
