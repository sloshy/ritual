import path from 'node:path'
import fs from 'node:fs/promises'
import { Command } from 'commander'
import { ArchidektClient } from '../clients/ArchidektClient'
import { FileTokenStore } from '../auth/FileTokenStore'
import { ArchidektAuth } from '../auth/ArchidektAuth'
import { importFromTextFile, listDeckFiles } from '../importers/text-file'
import { parseDeckFrontMatter, serializeDeckToMarkdown, resolveDeckFilePath } from '../deck-file'
import { appendChangelog } from '../changelog-writer'
import { getLogger } from '../logger'
import type { Card, DeckData, DeckSection } from '../types'
import type {
  ArchidektRawDeckResponse,
  ArchidektRawCardEntry,
  ModifyCardEntry,
  ModifyCardModifications,
} from '../importers/archidekt-types'
import {
  diffByCardName,
  diffToChangeEvents,
  isDiffEmpty,
  applyDownloadDiff,
  type NameDiff,
} from './deck-sync-helpers'
import { getBaseDir } from '../base-dir'

// ── Archidekt raw response helpers ────────────────────────────────────

type RawCardIndex = Map<string, { entry: ArchidektRawCardEntry; totalQty: number }>

/**
 * Build an index from an Archidekt raw deck response, keyed by card name (lowercase).
 * When multiple entries share a name, the first entry is kept and quantities are summed.
 */
function buildRawCardIndex(rawDeck: ArchidektRawDeckResponse): RawCardIndex {
  const index: RawCardIndex = new Map()
  for (const entry of rawDeck.cards) {
    const name = entry.card.oracleCard.name.toLowerCase()
    const existing = index.get(name)
    if (existing) {
      existing.totalQty += entry.quantity
    } else {
      index.set(name, { entry, totalQty: entry.quantity })
    }
  }
  return index
}

// ── Upload sync ───────────────────────────────────────────────────────

type UploadPlan = {
  entries: ModifyCardEntry[]
  errors: string[]
}

const DEFAULT_LABEL = ',#656565'

function createPatchIdGenerator(): () => string {
  let counter = 0
  return () => `ritual-${++counter}`
}

function modificationsFromRaw(
  entry: ArchidektRawCardEntry,
  quantity: number,
): ModifyCardModifications {
  return {
    quantity,
    modifier: entry.modifier,
    customCmc: entry.customCmc,
    companion: entry.companion,
    flippedDefault: entry.flippedDefault,
    label: entry.label,
  }
}

/**
 * Build modifyCards/v2/ entries from a name diff (local = new, archidekt = old).
 * For new adds, resolves Archidekt card IDs via search.
 * For removals and quantity changes, uses IDs from the raw deck index.
 */
async function buildUploadPlan(
  diff: NameDiff,
  localSections: DeckSection[],
  rawIndex: RawCardIndex,
  client: ArchidektClient,
  token: string,
): Promise<UploadPlan> {
  const entries: ModifyCardEntry[] = []
  const errors: string[] = []
  const nextPatchId = createPatchIdGenerator()

  // Remove cards: set quantity to 0
  for (const card of diff.removed) {
    const indexed = rawIndex.get(card.name.toLowerCase())
    if (!indexed) {
      errors.push(`Cannot remove card not found in Archidekt deck: ${card.name}`)
      continue
    }
    entries.push({
      action: 'remove',
      cardid: indexed.entry.card.id,
      customCardId: null,
      categories: indexed.entry.categories,
      patchId: nextPatchId(),
      modifications: modificationsFromRaw(indexed.entry, 0),
      deckRelationId: indexed.entry.id,
    })
  }

  // Quantity changes: set new absolute quantity
  for (const entry of diff.quantityChanged) {
    const indexed = rawIndex.get(entry.name.toLowerCase())
    if (!indexed) {
      errors.push(`Cannot update quantity for card not found in Archidekt deck: ${entry.name}`)
      continue
    }
    entries.push({
      action: 'modify',
      cardid: indexed.entry.card.id,
      customCardId: null,
      categories: indexed.entry.categories,
      patchId: nextPatchId(),
      modifications: modificationsFromRaw(indexed.entry, entry.newQty),
      deckRelationId: indexed.entry.id,
    })
  }

  // Add new cards: resolve Archidekt card edition ID via search
  for (const card of diff.added) {
    // Find the local card to get set info if available
    const localCard = findLocalCard(localSections, card.name)
    const result = await client.searchCards(card.name, localCard?.set, token)
    if (typeof result === 'string') {
      errors.push(result)
      continue
    }
    entries.push({
      action: 'add',
      cardid: result.id,
      customCardId: null,
      categories: [result.oracleCard.defaultCategory],
      patchId: nextPatchId(),
      modifications: {
        quantity: card.totalQuantity,
        modifier: result.options[0] ?? 'Normal',
        customCmc: null,
        companion: false,
        flippedDefault: false,
        label: DEFAULT_LABEL,
      },
    })
  }

  return { entries, errors }
}

function findLocalCard(sections: DeckSection[], cardName: string): Card | undefined {
  const nameLower = cardName.toLowerCase()
  for (const section of sections) {
    const card = section.cards.find((c) => c.name.toLowerCase() === nameLower)
    if (card) return card
  }
  return undefined
}

// ── Deck resolution helpers ───────────────────────────────────────────

function isArchidektDeck(frontMatter: Record<string, unknown>): boolean {
  const sourceUrl = frontMatter.sourceUrl as string | undefined
  return typeof sourceUrl === 'string' && sourceUrl.includes('archidekt.com')
}

function extractSourceId(frontMatter: Record<string, unknown>): string | undefined {
  return typeof frontMatter.sourceId === 'string' ? frontMatter.sourceId : undefined
}

type DeckTarget = {
  filePath: string
  frontMatter: Record<string, unknown>
  deck: DeckData
  sourceId: string
}

async function resolveTargetDecks(deckNames: string[], decksDir: string): Promise<DeckTarget[]> {
  const logger = getLogger()
  const targets: DeckTarget[] = []

  if (deckNames.length === 0) {
    // All Archidekt decks
    const files = await listDeckFiles(decksDir)
    for (const file of files) {
      const filePath = path.join(decksDir, file)
      const frontMatter = await parseDeckFrontMatter(filePath)
      if (!isArchidektDeck(frontMatter)) continue

      const sourceId = extractSourceId(frontMatter)
      if (!sourceId) {
        logger.warn(`Skipping ${file}: has Archidekt sourceUrl but no sourceId`)
        continue
      }

      const deck = await importFromTextFile(filePath)
      targets.push({ filePath, frontMatter, deck, sourceId })
    }
  } else {
    for (const name of deckNames) {
      const filePath = await resolveDeckFilePath(decksDir, name)
      if (!filePath) {
        logger.error(`Deck not found: ${name}`)
        continue
      }

      const frontMatter = await parseDeckFrontMatter(filePath)
      if (!isArchidektDeck(frontMatter)) {
        logger.error(`Deck "${name}" is not sourced from Archidekt`)
        continue
      }

      const sourceId = extractSourceId(frontMatter)
      if (!sourceId) {
        logger.error(`Deck "${name}" has Archidekt sourceUrl but no sourceId`)
        continue
      }

      const deck = await importFromTextFile(filePath)
      targets.push({ filePath, frontMatter, deck, sourceId })
    }
  }

  return targets
}

// ── Persistence helpers ───────────────────────────────────────────────

async function saveDeckWithSyncTimestamp(target: DeckTarget, deck: DeckData): Promise<void> {
  const updatedFrontMatter = { ...target.frontMatter, lastSynced: new Date().toISOString() }
  const markdown = serializeDeckToMarkdown(deck, updatedFrontMatter)
  await fs.writeFile(target.filePath, markdown)
}

// ── Command registration ──────────────────────────────────────────────

export function registerDeckSyncCommand(program: Command): void {
  program
    .command('deck-sync')
    .description('Sync deck changes with Archidekt')
    .argument('[decks...]', 'Deck names to sync (defaults to all Archidekt decks)')
    .option('--upload-changes', 'Push local changes to Archidekt')
    .option('--download-changes', 'Pull remote changes from Archidekt')
    .action(
      async (decks: string[], options: { uploadChanges?: boolean; downloadChanges?: boolean }) => {
        const logger = getLogger()

        if (options.uploadChanges && options.downloadChanges) {
          logger.error('Cannot use both --upload-changes and --download-changes at the same time')
          process.exit(1)
        }

        if (!options.uploadChanges && !options.downloadChanges) {
          logger.error('Specify either --upload-changes or --download-changes')
          process.exit(1)
        }

        const tokenStore = new FileTokenStore()
        const auth = new ArchidektAuth(tokenStore)
        const client = new ArchidektClient()

        // Check authentication
        const token = await auth.getToken()
        if (!token) {
          logger.error('Not signed into Archidekt. Run "ritual login archidekt" first.')
          process.exit(1)
        }

        const decksDir = path.join(getBaseDir(), 'decks')
        const targets = await resolveTargetDecks(decks, decksDir)

        if (targets.length === 0) {
          logger.info('No Archidekt decks found to sync.')
          return
        }

        if (options.downloadChanges) {
          await downloadChanges(targets, client, token, logger)
        } else {
          await uploadChanges(targets, client, token, logger)
        }
      },
    )
}

// ── Download flow ─────────────────────────────────────────────────────

async function downloadChanges(
  targets: DeckTarget[],
  client: ArchidektClient,
  token: string,
  logger: ReturnType<typeof getLogger>,
): Promise<void> {
  for (const target of targets) {
    logger.info(`Syncing "${target.deck.name}" (download)...`)

    let remoteDeck: DeckData
    try {
      remoteDeck = await client.fetchDeck(target.sourceId, token)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Failed to fetch Archidekt deck ${target.sourceId}: ${message}`)
      continue
    }

    const diff = diffByCardName(target.deck.sections, remoteDeck.sections)

    if (isDiffEmpty(diff)) {
      logger.info(`  No changes detected.`)
      continue
    }

    logger.info(
      `  Changes: +${diff.added.length} added, -${diff.removed.length} removed, ~${diff.quantityChanged.length} quantity changed`,
    )

    // Apply changes to local sections
    const updatedSections = applyDownloadDiff(target.deck.sections, diff)
    const updatedDeck: DeckData = { ...target.deck, sections: updatedSections }

    // Record changes in changelog
    const changes = diffToChangeEvents(diff)
    if (changes.length > 0) {
      await appendChangelog(target.filePath, target.deck.name, changes)
    }

    // Write updated deck with lastSynced
    await saveDeckWithSyncTimestamp(target, updatedDeck)
    logger.info(`  Saved.`)
  }
}

// ── Upload flow ───────────────────────────────────────────────────────

async function uploadChanges(
  targets: DeckTarget[],
  client: ArchidektClient,
  token: string,
  logger: ReturnType<typeof getLogger>,
): Promise<void> {
  // Fetch owned deck IDs for ownership check
  let ownedDeckIds: Set<string>
  try {
    const ownDecks = await client.fetchOwnDecks(token)
    ownedDeckIds = new Set(ownDecks.map((d) => d.id.toString()))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to fetch owned decks: ${message}`)
    return
  }

  for (const target of targets) {
    logger.info(`Syncing "${target.deck.name}" (upload)...`)

    if (!ownedDeckIds.has(target.sourceId)) {
      logger.warn(`  Skipping: you do not own Archidekt deck ${target.sourceId}`)
      continue
    }

    let rawDeck: ArchidektRawDeckResponse
    try {
      rawDeck = await client.fetchDeckRaw(target.sourceId, token)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`  Failed to fetch Archidekt deck ${target.sourceId}: ${message}`)
      continue
    }

    // Parse raw response into DeckData for diffing (reuse existing parser)
    const remoteDeck = await client.fetchDeck(target.sourceId, token)
    const diff = diffByCardName(remoteDeck.sections, target.deck.sections)

    if (isDiffEmpty(diff)) {
      logger.info(`  No changes to upload.`)
      continue
    }

    logger.info(
      `  Changes: +${diff.added.length} to add, -${diff.removed.length} to remove, ~${diff.quantityChanged.length} quantity changes`,
    )

    const rawIndex = buildRawCardIndex(rawDeck)
    const plan = await buildUploadPlan(diff, target.deck.sections, rawIndex, client, token)

    if (plan.errors.length > 0) {
      for (const err of plan.errors) {
        logger.warn(`  ${err}`)
      }
    }

    if (plan.entries.length > 0) {
      try {
        await client.modifyCards(target.sourceId, plan.entries, token)
        logger.info(`  Pushed ${plan.entries.length} card changes to Archidekt.`)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`  Failed to push changes: ${message}`)
        continue
      }
    }

    // Update lastSynced in front matter
    await saveDeckWithSyncTimestamp(target, target.deck)
    logger.info(`  Updated lastSynced.`)
  }
}
