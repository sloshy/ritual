import fs from 'node:fs'
import path from 'node:path'
import type { ScryfallCard } from '../../../src/types'
import type { ScryfallSymbol } from '../../../src/scryfall'
import type { CachedItem, CacheSchema } from '../../../src/cache/file-cache'
import type { RitualConfig } from '../../../src/ritual-config'

/**
 * Builds the fully synthetic workspace the e2e servers run against: seed
 * decks/collections/wanted lists, a ritual.config.json, and a pre-populated
 * Scryfall cache (cards, symbology, symbol SVGs) so `build-site --no-refresh`
 * and the admin server never touch the network or the developer's real data.
 */

/** Deck slug (public site + admin) that specs may navigate to directly. */
export const SYNTHETIC_DECK_SLUG = 'test-unset-commander'
/** Collection slug (public site + admin) that specs may navigate to directly. */
export const SYNTHETIC_COLLECTION_SLUG = 'test-binder'

type SeedPrinting = {
  id: string
  set: string
  setName: string
  collectorNumber: string
  rarity: string
  releasedAt: string
  finishes: string[]
  prices: ScryfallCard['prices']
}

type SeedCard = {
  name: string
  cmc: number
  manaCost: string
  typeLine: string
  oracleText: string
  colorIdentity: string[]
  oracleTags: string[]
  printings: SeedPrinting[]
}

function makePrices(usd: string, foil?: string): ScryfallCard['prices'] {
  return {
    usd,
    usd_foil: foil ?? null,
    usd_etched: null,
    eur: usd,
    eur_foil: foil ?? null,
    tix: '0.05',
  }
}

/**
 * Fake-but-well-formed cards. Every card name referenced by a seed list below
 * MUST appear here so the site build and admin editors run entirely offline.
 * Set codes are lowercase (internal representation); markdown renders them
 * uppercase.
 */
const SEED_CARDS: SeedCard[] = [
  {
    name: 'Sol Ring',
    cmc: 1,
    manaCost: '{1}',
    typeLine: 'Artifact',
    oracleText: '{T}: Add {C}{C}.',
    colorIdentity: [],
    oracleTags: ['mana-rock'],
    printings: [
      {
        id: 'e2e00000-0000-4000-8000-000000000001',
        set: 'lea',
        setName: 'Limited Edition Alpha',
        collectorNumber: '270',
        rarity: 'uncommon',
        releasedAt: '1993-08-05',
        finishes: ['nonfoil'],
        prices: makePrices('25.00'),
      },
      {
        id: 'e2e00000-0000-4000-8000-000000000002',
        set: 'c21',
        setName: 'Commander 2021',
        collectorNumber: '263',
        rarity: 'uncommon',
        releasedAt: '2021-04-23',
        finishes: ['nonfoil', 'foil'],
        prices: makePrices('1.50', '3.00'),
      },
    ],
  },
  {
    name: 'Lightning Bolt',
    cmc: 1,
    manaCost: '{R}',
    typeLine: 'Instant',
    oracleText: 'Lightning Bolt deals 3 damage to any target.',
    colorIdentity: ['R'],
    oracleTags: ['burn', 'removal'],
    printings: [
      {
        id: 'e2e00000-0000-4000-8000-000000000003',
        set: 'lea',
        setName: 'Limited Edition Alpha',
        collectorNumber: '161',
        rarity: 'common',
        releasedAt: '1993-08-05',
        finishes: ['nonfoil', 'foil'],
        prices: makePrices('50.00', '120.00'),
      },
      {
        id: 'e2e00000-0000-4000-8000-000000000004',
        set: 'sta',
        setName: 'Strixhaven Mystical Archive',
        collectorNumber: '42',
        rarity: 'rare',
        releasedAt: '2021-04-23',
        finishes: ['nonfoil', 'foil'],
        prices: makePrices('2.00', '5.00'),
      },
    ],
  },
  {
    name: 'Counterspell',
    cmc: 2,
    manaCost: '{U}{U}',
    typeLine: 'Instant',
    oracleText: 'Counter target spell.',
    colorIdentity: ['U'],
    oracleTags: ['counterspell'],
    printings: [
      {
        id: 'e2e00000-0000-4000-8000-000000000005',
        set: 'lea',
        setName: 'Limited Edition Alpha',
        collectorNumber: '54',
        rarity: 'uncommon',
        releasedAt: '1993-08-05',
        finishes: ['nonfoil'],
        prices: makePrices('5.00'),
      },
    ],
  },
  {
    name: 'Dark Ritual',
    cmc: 1,
    manaCost: '{B}',
    typeLine: 'Instant',
    oracleText: 'Add {B}{B}{B}.',
    colorIdentity: ['B'],
    oracleTags: ['ritual'],
    printings: [
      {
        id: 'e2e00000-0000-4000-8000-000000000006',
        set: 'lea',
        setName: 'Limited Edition Alpha',
        collectorNumber: '98',
        rarity: 'common',
        releasedAt: '1993-08-05',
        finishes: ['nonfoil'],
        prices: makePrices('3.00'),
      },
    ],
  },
  {
    name: 'Serra Angel',
    cmc: 5,
    manaCost: '{3}{W}{W}',
    typeLine: 'Creature — Angel',
    oracleText: 'Flying, vigilance',
    colorIdentity: ['W'],
    oracleTags: ['flying'],
    printings: [
      {
        id: 'e2e00000-0000-4000-8000-000000000007',
        set: 'fdn',
        setName: 'Foundations',
        collectorNumber: '35',
        rarity: 'uncommon',
        releasedAt: '2024-11-15',
        finishes: ['nonfoil', 'foil'],
        prices: makePrices('0.50', '1.20'),
      },
    ],
  },
  {
    name: 'Emberwild Phoenix',
    cmc: 4,
    manaCost: '{2}{R}{R}',
    typeLine: 'Legendary Creature — Phoenix',
    oracleText: 'Flying, haste',
    colorIdentity: ['R'],
    oracleTags: ['flying'],
    printings: [
      {
        id: 'e2e00000-0000-4000-8000-000000000008',
        set: 'tst',
        setName: 'Test Set',
        collectorNumber: '1',
        rarity: 'mythic',
        releasedAt: '2026-01-01',
        finishes: ['nonfoil', 'foil'],
        prices: makePrices('4.00', '9.00'),
      },
    ],
  },
]

/** Placeholder card image embedded as a data URI so pages never fetch remotely. */
function cardImageDataUri(label: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680">` +
    `<rect width="100%" height="100%" rx="22" fill="#3a3f4b"/>` +
    `<text x="244" y="340" font-size="36" fill="#e6e6e6" text-anchor="middle" font-family="sans-serif">${label}</text>` +
    `</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function toScryfallCard(seed: SeedCard, printing: SeedPrinting): ScryfallCard {
  const image = cardImageDataUri(seed.name)
  return {
    id: printing.id,
    oracle_id: `oracle-${seed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    illustration_id: `illus-${printing.id}`,
    name: seed.name,
    layout: 'normal',
    cmc: seed.cmc,
    mana_cost: seed.manaCost,
    type_line: seed.typeLine,
    oracle_text: seed.oracleText,
    image_uris: {
      small: image,
      normal: image,
      large: image,
      png: image,
      art_crop: image,
      border_crop: image,
    },
    prices: printing.prices,
    finishes: printing.finishes,
    games: ['paper'],
    set: printing.set,
    set_name: printing.setName,
    collector_number: printing.collectorNumber,
    rarity: printing.rarity,
    color_identity: seed.colorIdentity,
    released_at: printing.releasedAt,
    oracleTags: seed.oracleTags,
  }
}

// ===== Cache file =====

function buildCacheJson(): CacheSchema {
  const now = Date.now()
  const cards: Record<string, CachedItem<ScryfallCard[]>> = {}
  const cardNameIndex: Record<string, string> = {}
  for (const seed of SEED_CARDS) {
    cards[seed.name] = {
      timestamp: now,
      data: seed.printings.map((p) => toScryfallCard(seed, p)),
      lowercaseName: seed.name.toLowerCase(),
    }
    cardNameIndex[seed.name.toLowerCase()] = seed.name
  }
  return {
    prices: {},
    cards,
    cardNameIndex,
    metadata: { cards: { lastRefreshedAt: now } },
  }
}

// ===== Symbology (every {X} token used by the seed cards above) =====

type SymbolSeed = {
  symbol: string
  english: string
  representsMana: boolean
  appearsInManaCosts: boolean
  cmc?: number
  colors: string[]
}

const SEED_SYMBOLS: SymbolSeed[] = [
  {
    symbol: '{T}',
    english: 'tap this permanent',
    representsMana: false,
    appearsInManaCosts: false,
    colors: [],
  },
  {
    symbol: '{1}',
    english: 'one generic mana',
    representsMana: true,
    appearsInManaCosts: true,
    cmc: 1,
    colors: [],
  },
  {
    symbol: '{2}',
    english: 'two generic mana',
    representsMana: true,
    appearsInManaCosts: true,
    cmc: 2,
    colors: [],
  },
  {
    symbol: '{3}',
    english: 'three generic mana',
    representsMana: true,
    appearsInManaCosts: true,
    cmc: 3,
    colors: [],
  },
  {
    symbol: '{W}',
    english: 'one white mana',
    representsMana: true,
    appearsInManaCosts: true,
    cmc: 1,
    colors: ['W'],
  },
  {
    symbol: '{U}',
    english: 'one blue mana',
    representsMana: true,
    appearsInManaCosts: true,
    cmc: 1,
    colors: ['U'],
  },
  {
    symbol: '{B}',
    english: 'one black mana',
    representsMana: true,
    appearsInManaCosts: true,
    cmc: 1,
    colors: ['B'],
  },
  {
    symbol: '{R}',
    english: 'one red mana',
    representsMana: true,
    appearsInManaCosts: true,
    cmc: 1,
    colors: ['R'],
  },
  {
    symbol: '{C}',
    english: 'one colorless mana',
    representsMana: true,
    appearsInManaCosts: true,
    cmc: 1,
    colors: [],
  },
]

function toScryfallSymbol(seed: SymbolSeed): ScryfallSymbol {
  const safeName = seed.symbol.replace(/[{}]/g, '').replace(/\//g, '')
  return {
    symbol: seed.symbol,
    // Never fetched: downloadSymbol finds the pre-seeded SVG in cache/images/.
    svg_uri: `https://symbols.invalid/${safeName}.svg`,
    english: seed.english,
    transposable: false,
    represents_mana: seed.representsMana,
    appears_in_mana_costs: seed.appearsInManaCosts,
    cmc: seed.cmc,
    funny: false,
    colors: seed.colors,
  }
}

function symbolSvg(label: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<circle cx="50" cy="50" r="50" fill="#cbc2bf"/>` +
    `<text x="50" y="66" font-size="48" text-anchor="middle" font-family="sans-serif">${label}</text>` +
    `</svg>`
  )
}

// ===== List markdown (set codes uppercase in rendered markdown) =====

const DECK_TEST_UNSET_COMMANDER = `---
name: "Test Unset Commander"
tags: []
---

## Commander
1 Sol Ring &1

## Main
1 Lightning Bolt &2
1 Counterspell &3
1 Dark Ritual &4
`

const DECK_EMBERWILD_AGGRO = `---
name: "Emberwild Aggro"
tags: []
---

## Commander
1 Emberwild Phoenix &1

## Main
3 Lightning Bolt &2
2 Dark Ritual &3
1 Serra Angel &4
`

const COLLECTION_TEST_BINDER = `# Test Binder

## Main
- Serra Angel (FDN:35) [NM] &1
- Lightning Bolt (LEA:161) [foil] [NM] &2
- Sol Ring (C21:263) [NM] &3
`

const WANTED_TEST_WANTS = `# Test Wants

## Main
- Counterspell &1
- Serra Angel (FDN:35) &2
`

const RITUAL_CONFIG = {
  decksDir: './decks',
  collectionsDir: './collections',
  wantedDir: './wanted',
  defaultCurrency: 'usd',
  cacheLockTimeoutSeconds: 300,
  cacheSource: 'scryfall',
  admin: {
    gitEnabled: false,
    gitAutoCommit: false,
    gitAutoPush: false,
    trustProxy: false,
    secureCookies: false,
    ipAllowList: [],
    ipDenyList: [],
    userAgentAllowList: [],
    userAgentDenyList: [],
    rateLimitEnabled: true,
    rateLimitMaxAttempts: 5,
    rateLimitWindowMinutes: 5,
    // No artificial failed-login delay: nothing asserts on it, and it would
    // only slow the wrong-credentials specs down.
    failedAuthDelayMs: 0,
  },
} satisfies RitualConfig

/** Create the complete synthetic workspace inside `dir` (which must exist). */
export function createSyntheticWorkspace(dir: string): void {
  const decksDir = path.join(dir, 'decks')
  const collectionsDir = path.join(dir, 'collections')
  const wantedDir = path.join(dir, 'wanted')
  const cacheDir = path.join(dir, 'cache')
  const imageCacheDir = path.join(cacheDir, 'images')

  for (const d of [decksDir, collectionsDir, wantedDir, cacheDir, imageCacheDir]) {
    fs.mkdirSync(d, { recursive: true })
  }

  fs.writeFileSync(path.join(dir, 'ritual.config.json'), JSON.stringify(RITUAL_CONFIG, null, 2))

  fs.writeFileSync(path.join(decksDir, `${SYNTHETIC_DECK_SLUG}.md`), DECK_TEST_UNSET_COMMANDER)
  fs.writeFileSync(path.join(decksDir, 'emberwild-aggro.md'), DECK_EMBERWILD_AGGRO)
  fs.writeFileSync(
    path.join(collectionsDir, `${SYNTHETIC_COLLECTION_SLUG}.md`),
    COLLECTION_TEST_BINDER,
  )
  fs.writeFileSync(path.join(wantedDir, 'test-wants.md'), WANTED_TEST_WANTS)

  fs.writeFileSync(path.join(cacheDir, 'cache.json'), JSON.stringify(buildCacheJson(), null, 2))
  fs.writeFileSync(
    path.join(cacheDir, 'symbology.json'),
    JSON.stringify(SEED_SYMBOLS.map(toScryfallSymbol), null, 2),
  )

  // Pre-seed symbol SVGs so downloadSymbol() copies from the image cache
  // instead of fetching each symbol's svg_uri.
  for (const seed of SEED_SYMBOLS) {
    const safeName = seed.symbol.replace(/[{}]/g, '').replace(/\//g, '')
    fs.writeFileSync(path.join(imageCacheDir, `symbol_${safeName}.svg`), symbolSvg(safeName))
  }
}
