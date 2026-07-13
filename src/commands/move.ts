import { Command } from 'commander'
import prompts, { type Choice } from 'prompts'
import type { PromptState } from './prompts-types'
import { promptExitMenu } from './prompts-helpers'
import { resolveCardPrinting } from './collection-helpers'
import { listRefLabel, type ListRef } from '../change-event'
import type { ListEntry, MoveSessionConfig, VirtualCard } from './move-helpers'
import {
  loadAllLists,
  loadPhysicalCards,
  buildVirtualState,
  applyVirtualMove,
  getPendingMoves,
  buildCardSearchChoices,
  commitAllMoves,
  getToggleState,
  toggleStateChar,
  toggleSetAll,
  finishLabel,
} from './move-helpers'

/** The main move-session prompt resolves to a menu sentinel or a physical-card key. */
type MoveSelectionResponse = { selection?: string }

/**
 * The move menu's sentinel values. Matched by exact membership rather than a
 * `__` prefix check, since a card choice's value is a physical-card key and must
 * never be mistaken for a menu item.
 */
const MOVE_MENU_SENTINELS: ReadonlySet<string> = new Set([
  '__VIEW_PENDING__',
  '__CONFIG__',
  '__EXIT__',
])

/** A choice is a menu item (vs. a card) when its value is exactly a known sentinel. */
export const isMoveMenuChoice = (choice: Choice): boolean =>
  typeof choice.value === 'string' && MOVE_MENU_SENTINELS.has(choice.value)

/**
 * The move session's menu items, which sit above the card choices. The moves
 * queued so far lead it — they are what the last search actually produced —
 * while the source/destination filters are a once-per-session setup step, and
 * Exit sits at the foot where it cannot be reached by overshooting.
 */
export function buildMoveMenuChoices(pendingCount: number): Choice[] {
  return [
    {
      title:
        pendingCount > 0 ? `📋 View Pending Changes (${pendingCount})` : '📋 View Pending Changes',
      value: '__VIEW_PENDING__',
    },
    { title: '⚙️  Configure Session Filters', value: '__CONFIG__' },
    { title: '🚪 Exit', value: '__EXIT__' },
  ]
}

/** The session's lists, bucketed by list type for the toggle menus. */
type ListsByType = Record<ListRef['type'], ListEntry[]>

export function registerMoveCommand(program: Command): void {
  program
    .command('move')
    .description('Interactively move cards between decks, collections, and wanted lists')
    .action(async () => {
      console.log('Loading all lists...')
      const allLists = await loadAllLists()

      if (allLists.length === 0) {
        console.log('No list files found. Create a deck, collection, or wanted list first.')
        return
      }

      console.log('Loading cards...')
      const physicalCards = await loadPhysicalCards(allLists)

      if (physicalCards.length === 0) {
        console.log('No cards found in any list.')
        return
      }

      const virtualState = buildVirtualState(physicalCards)
      const config: MoveSessionConfig = {
        enabledSources: new Set(allLists.map((l) => l.filePath)),
        enabledDestinations: new Set(allLists.map((l) => l.filePath)),
        allLists,
      }

      console.log(`Ready. ${physicalCards.length} card(s) across ${allLists.length} list(s).`)

      while (true) {
        let isExited = false
        const pending = getPendingMoves(virtualState)
        const cardChoices = buildCardSearchChoices(virtualState, config.enabledSources)

        const menuChoices: Choice[] = buildMoveMenuChoices(pending.length)

        const allChoices: Choice[] = [
          ...menuChoices,
          ...cardChoices.map((c) => ({ title: c.title, value: c.value })),
        ]

        const response = (await prompts({
          type: 'autocomplete',
          name: 'selection',
          message: 'Search for a card to move, or choose an option:',
          choices: allChoices,
          limit: 12,
          suggest: async (rawInput, choices) => {
            const input = String(rawInput).toLowerCase().trim()
            if (!input) return choices.filter(isMoveMenuChoice)

            const terms = input.split(/\s+/).filter(Boolean)
            return choices.filter((choice) => {
              // Always show menu items when filtering
              if (isMoveMenuChoice(choice)) return true
              const title = choice.title.toLowerCase()
              return terms.every((term) => title.includes(term))
            })
          },
          onState: (state: PromptState) => {
            if (state.exited) isExited = true
          },
        })) as MoveSelectionResponse

        if (isExited || response.selection === undefined || response.selection === '__EXIT__') {
          const pendingNow = getPendingMoves(virtualState)
          if (pendingNow.length > 0) {
            const choice = await promptExitMenu(pendingNow.length)
            if (choice === 'cancel') continue
            if (choice === 'save') await savePendingMoves(virtualState)
          }
          break
        }

        const selection: string = response.selection

        if (selection === '__CONFIG__') {
          await handleConfig(config)
          continue
        }

        if (selection === '__VIEW_PENDING__') {
          handleViewPending(virtualState)
          continue
        }

        // Card selection
        const vc = virtualState.get(selection)
        if (!vc) continue

        await handleCardMove(vc, config, virtualState)
      }
    })
}

async function savePendingMoves(virtualState: Map<string, VirtualCard>): Promise<void> {
  const pending = getPendingMoves(virtualState)
  if (pending.length === 0) {
    console.log('No pending moves.')
    return
  }

  console.log(`Saving ${pending.length} move(s)...`)
  const { moved } = await commitAllMoves(virtualState)
  console.log(`Done. Moved ${moved} card(s).`)
}

function handleViewPending(virtualState: Map<string, VirtualCard>): void {
  const pending = getPendingMoves(virtualState)
  if (pending.length === 0) {
    console.log('No pending moves.')
    return
  }

  console.log(`\nPending moves (${pending.length}):`)
  for (const vc of pending) {
    const card = vc.card
    const from = listRefLabel(vc.pendingMove.originalList.ref)
    const to = listRefLabel(vc.currentList.ref)
    const printingPart =
      card.set && card.collectorNumber ? ` (${card.set.toUpperCase()}:${card.collectorNumber})` : ''
    const finishPart = finishLabel(card.finish)
    const idPart = card.cardId !== undefined ? ` &${card.cardId}` : ''
    console.log(`  ${card.name}${printingPart}${finishPart}${idPart}: ${from} → ${to}`)
  }
  console.log('')
}

async function handleCardMove(
  vc: VirtualCard,
  config: MoveSessionConfig,
  virtualState: Map<string, VirtualCard>,
): Promise<void> {
  const card = vc.card

  // Determine valid destinations (enabled destinations minus the card's current list)
  const validDests = config.allLists.filter(
    (l) => config.enabledDestinations.has(l.filePath) && l.filePath !== vc.currentList.filePath,
  )

  if (validDests.length === 0) {
    console.log('No valid destinations available. Configure destinations in session filters.')
    return
  }

  // If card is a name-only wanted entry moving to a collection, prompt for printing
  let resolvedCard = card

  // Pick destination first
  let destList: ListEntry

  if (validDests.length === 1) {
    destList = validDests[0]!
  } else {
    const destChoices: Choice[] = validDests.map((l) => ({
      title: listRefLabel(l.ref),
      value: l.filePath,
    }))

    let destExited = false
    const destResponse = await prompts({
      type: 'autocomplete',
      name: 'dest',
      message: `Move "${card.name}" to:`,
      choices: destChoices,
      limit: 15,
      suggest: async (rawInput, choices) => {
        const input = String(rawInput).toLowerCase().trim()
        if (!input) return choices
        const terms = input.split(/\s+/).filter(Boolean)
        return choices.filter((choice) => {
          const title = choice.title.toLowerCase()
          return terms.every((term) => title.includes(term))
        })
      },
      onState: (state: PromptState) => {
        if (state.exited) destExited = true
      },
    })

    if (destExited || destResponse.dest === undefined) return

    const found = validDests.find((l) => l.filePath === destResponse.dest)
    if (!found) return
    destList = found
  }

  // Only resolve printing when the chosen destination is a collection and the card lacks it
  if (destList.ref.type === 'collection' && (!card.set || !card.collectorNumber)) {
    console.log(`"${card.name}" has no printing info. Resolve printing for collection destination.`)
    const result = await resolveCardPrinting(card.name, {}, false)
    if (!result) {
      console.log('Printing selection cancelled.')
      return
    }
    resolvedCard = {
      ...card,
      set: result.printing.set.toLowerCase(),
      collectorNumber: result.printing.collector_number,
    }
  }

  // If we resolved printing, update the virtual card's data in-place
  if (resolvedCard !== card) {
    const updatedVc = virtualState.get(vc.physicalKey)
    if (updatedVc) {
      updatedVc.card = resolvedCard
    }
  }

  applyVirtualMove(virtualState, vc.physicalKey, destList)

  const printingPart =
    resolvedCard.set && resolvedCard.collectorNumber
      ? ` (${resolvedCard.set.toUpperCase()}:${resolvedCard.collectorNumber})`
      : ''
  const finishPart = finishLabel(resolvedCard.finish)
  console.log(
    `  ✓ Queued: ${resolvedCard.name}${printingPart}${finishPart} → ${listRefLabel(destList.ref)}`,
  )
}

async function handleConfig(config: MoveSessionConfig): Promise<void> {
  while (true) {
    const response = await prompts({
      type: 'select',
      name: 'option',
      message: 'Session Filters:',
      choices: [
        { title: 'Configure Sources (which lists to move cards FROM)', value: 'sources' },
        { title: 'Configure Destinations (which lists to move cards TO)', value: 'destinations' },
        { title: '← Back', value: 'back' },
      ],
    })

    if (!response.option || response.option === 'back') break

    if (response.option === 'sources') {
      await promptListToggle(config.enabledSources, config.allLists, 'Move FROM', false)
    } else if (response.option === 'destinations') {
      await promptListToggle(config.enabledDestinations, config.allLists, 'Move TO', true)
    }
  }
}

async function promptListToggle(
  enabledSet: Set<string>,
  allLists: ListEntry[],
  label: string,
  requireAtLeastOne: boolean,
): Promise<void> {
  const byType: ListsByType = {
    deck: allLists.filter((l) => l.ref.type === 'deck'),
    collection: allLists.filter((l) => l.ref.type === 'collection'),
    wanted: allLists.filter((l) => l.ref.type === 'wanted'),
  }

  while (true) {
    const deckPaths = byType.deck.map((l) => l.filePath)
    const collPaths = byType.collection.map((l) => l.filePath)
    const wantedPaths = byType.wanted.map((l) => l.filePath)

    const deckState = getToggleState(deckPaths, enabledSet)
    const collState = getToggleState(collPaths, enabledSet)
    const wantedState = getToggleState(wantedPaths, enabledSet)

    const choices: Choice[] = []

    if (byType.deck.length > 0) {
      choices.push({
        title: `[${toggleStateChar(deckState)}] Decks (${deckPaths.filter((p) => enabledSet.has(p)).length}/${deckPaths.length})`,
        value: 'type:deck',
      })
    }
    if (byType.collection.length > 0) {
      choices.push({
        title: `[${toggleStateChar(collState)}] Collections (${collPaths.filter((p) => enabledSet.has(p)).length}/${collPaths.length})`,
        value: 'type:collection',
      })
    }
    if (byType.wanted.length > 0) {
      choices.push({
        title: `[${toggleStateChar(wantedState)}] Wanted Lists (${wantedPaths.filter((p) => enabledSet.has(p)).length}/${wantedPaths.length})`,
        value: 'type:wanted',
      })
    }

    choices.push(
      { title: '── Toggle All ON ──', value: '__ALL_ON__' },
      { title: '── Toggle All OFF ──', value: '__ALL_OFF__' },
      { title: '← Done', value: '__BACK__' },
    )

    const response = await prompts({
      type: 'select',
      name: 'action',
      message: `${label} — Toggle Lists:`,
      choices,
    })

    if (!response.action || response.action === '__BACK__') break

    if (response.action === '__ALL_ON__') {
      toggleSetAll(
        enabledSet,
        allLists.map((l) => l.filePath),
        true,
      )
      continue
    }

    if (response.action === '__ALL_OFF__') {
      if (requireAtLeastOne) {
        console.log('At least one destination must remain enabled.')
        continue
      }
      toggleSetAll(
        enabledSet,
        allLists.map((l) => l.filePath),
        false,
      )
      continue
    }

    if (response.action === 'type:deck') {
      await promptSubListToggle(enabledSet, byType.deck, 'Decks', requireAtLeastOne, allLists)
    } else if (response.action === 'type:collection') {
      await promptSubListToggle(
        enabledSet,
        byType.collection,
        'Collections',
        requireAtLeastOne,
        allLists,
      )
    } else if (response.action === 'type:wanted') {
      await promptSubListToggle(
        enabledSet,
        byType.wanted,
        'Wanted Lists',
        requireAtLeastOne,
        allLists,
      )
    }
  }
}

async function promptSubListToggle(
  enabledSet: Set<string>,
  lists: ListEntry[],
  categoryLabel: string,
  requireAtLeastOne: boolean,
  allLists: ListEntry[],
): Promise<void> {
  while (true) {
    const choices: Choice[] = lists.map((l) => ({
      title: `[${enabledSet.has(l.filePath) ? 'X' : ' '}] ${l.ref.name}`,
      value: l.filePath,
    }))

    choices.push(
      { title: '── Toggle All ON ──', value: '__ALL_ON__' },
      { title: '── Toggle All OFF ──', value: '__ALL_OFF__' },
      { title: '← Back', value: '__BACK__' },
    )

    const response = await prompts({
      type: 'select',
      name: 'action',
      message: `${categoryLabel}:`,
      choices,
    })

    if (!response.action || response.action === '__BACK__') break

    if (response.action === '__ALL_ON__') {
      toggleSetAll(
        enabledSet,
        lists.map((l) => l.filePath),
        true,
      )
      continue
    }

    if (response.action === '__ALL_OFF__') {
      if (requireAtLeastOne) {
        const allPaths = allLists.map((l) => l.filePath)
        const otherEnabled = allPaths.filter(
          (p) => enabledSet.has(p) && !lists.some((l) => l.filePath === p),
        )
        if (otherEnabled.length === 0) {
          console.log('At least one destination must remain enabled.')
          continue
        }
      }
      toggleSetAll(
        enabledSet,
        lists.map((l) => l.filePath),
        false,
      )
      continue
    }

    // Toggle individual item
    if (typeof response.action !== 'string') break
    const targetPath = response.action
    if (enabledSet.has(targetPath)) {
      if (requireAtLeastOne) {
        const remaining = allLists.filter(
          (l) => enabledSet.has(l.filePath) && l.filePath !== targetPath,
        )
        if (remaining.length === 0) {
          console.log('At least one destination must remain enabled.')
          continue
        }
      }
      enabledSet.delete(targetPath)
    } else {
      enabledSet.add(targetPath)
    }
  }
}
