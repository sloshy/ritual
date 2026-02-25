import { Command } from 'commander'
import prompts, { type Choice } from 'prompts'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { getAllCardNames, getCardsBySet, isDigitalOnlySet } from '../scryfall'
import type { ScryfallCard } from '../types'

export function registerCollectionCommand(program: Command) {
  program
    .command('collection')
    .alias('collect')
    .description('Manage your collection of cards by interactively adding them')
    .option('-s, --sets <codes>', 'Filter by set codes (comma-separated, e.g., "FDN, SPG")')
    .option('-f, --finish <finish>', 'Default finish (nonfoil, foil, etched)')
    .option('-c, --condition <condition>', 'Default condition (NM, LP, MP, HP, DMG)')
    .option('--collector', 'Start in collector number mode')
    .option('--allow-digital-only-cards', 'Include digital-only sets (e.g., Alchemy)')
    .action(async (options) => {
      const parsedSets = options.sets
        ? options.sets
            .split(',')
            .map((s: string) => s.trim().toLowerCase())
            .filter((s: string) => s.length > 0)
        : undefined
      const excludeDigitalOnly = !options.allowDigitalOnlyCards

      console.log('Loading card database for autocomplete...')
      let cardNames = await getAllCardNames({ sets: parsedSets, excludeDigitalOnly })

      if (cardNames.length === 0) {
        console.log('Cache is empty. Please run preload to populate the cache for autocomplete.')
        // getAllCardNames should have already prompted, but if they declined, we can't do much.
        return
      }

      console.log(`Loaded ${cardNames.length} cards.`)

      // Ensure collections directory exists
      const collectionsDir = path.join(process.cwd(), 'collections')
      if (!(await Bun.file(collectionsDir).exists())) {
        await fs.mkdir(collectionsDir, { recursive: true })
      }

      // List existing collections
      const files = await fs.readdir(collectionsDir)
      const existingCollections = files
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace('.md', ''))

      let selectedCollection: string

      // Prompt for selection
      const selectionResponse = await prompts({
        type: 'autocomplete',
        name: 'collection',
        message: 'Select a collection file',
        choices: [
          ...existingCollections.map((c) => ({ title: c, value: c })),
          { title: '+ Create New Collection', value: '__NEW__' },
        ],
      })

      if (!selectionResponse.collection) {
        return
      }

      if (selectionResponse.collection === '__NEW__') {
        const nameResponse = await prompts({
          type: 'text',
          name: 'name',
          message: 'Enter name for new collection:',
          validate: (value) => (value.length > 0 ? true : 'Name cannot be empty'),
        })

        if (!nameResponse.name) return
        selectedCollection = nameResponse.name
      } else {
        selectedCollection = selectionResponse.collection
      }

      const collectionFile = path.join(collectionsDir, `${selectedCollection}.md`)

      // Ensure file exists with header if new
      if (!(await Bun.file(collectionFile).exists())) {
        await fs.writeFile(collectionFile, `# ${selectedCollection}\n\n`)
        console.log(`Created new collection file: ${selectedCollection}.md`)
      } else {
        console.log(`Using collection file: ${selectedCollection}.md`)
      }

      const validFinishes = ['nonfoil', 'foil', 'etched']
      const validConditions = ['NM', 'LP', 'MP', 'HP', 'DMG']

      let sessionConfig: {
        sets?: string[]
        finish?: string
        condition?: string
        entryMode: 'name' | 'collector'
        collectorSets: string[]
        activeSetIndex: number
        setCardMaps: Map<string, Map<string, ScryfallCard>>
      } = {
        sets: parsedSets,
        finish: validFinishes.includes(options.finish) ? options.finish : undefined,
        condition: validConditions.includes(options.condition?.toUpperCase())
          ? options.condition.toUpperCase()
          : undefined,
        entryMode: options.collector ? 'collector' : 'name',
        collectorSets: [],
        activeSetIndex: 0,
        setCardMaps: new Map(),
      }

      // Pre-load set data when starting in collector mode with sets provided
      if (options.collector && parsedSets && parsedSets.length > 0) {
        console.log('Loading set data...')
        for (const setCode of parsedSets) {
          console.log(`Loading ${setCode.toUpperCase()}...`)
          const cardMap = await getCardsBySet(setCode)
          sessionConfig.setCardMaps.set(setCode.toLowerCase(), cardMap)
          console.log(`  ${cardMap.size} cards loaded`)
        }
        sessionConfig.collectorSets = parsedSets
        sessionConfig.activeSetIndex = 0
      }

      let lastAddedCard: { name: string; line: string } | null = null
      let lastAddedCount = 0

      while (true) {
        let isExited = false
        let forcePrompts = false

        // Build choices based on entry mode
        let choices: Choice[]

        if (sessionConfig.entryMode === 'name') {
          choices = [
            ...(lastAddedCard
              ? [
                  {
                    title: `➕ Add Another Copy (${lastAddedCard.name})`,
                    value: '__ADD_ANOTHER__',
                  },
                ]
              : []),
            { title: '⚙️  Configure Session Filters', value: '__CONFIG__' },
            { title: '🔢 Switch to Collector Number Mode', value: '__COLLECTOR_MODE__' },
            ...(lastAddedCard
              ? [
                  {
                    title: `✏️  Edit Previous Card (${lastAddedCard.name})`,
                    value: '__EDIT_LAST__',
                  },
                ]
              : []),
            ...cardNames.map((name) => ({ title: name, value: name })),
          ]
        } else {
          // Collector number mode
          const activeSet = sessionConfig.collectorSets[sessionConfig.activeSetIndex] || ''
          const setCardMap = sessionConfig.setCardMaps.get(activeSet.toLowerCase()) || new Map()

          // Build collector number choices
          const collectorChoices: Choice[] = []
          for (const [num, card] of setCardMap) {
            collectorChoices.push({
              title: `${num} - ${card.name}`,
              value: { type: 'card', num, card },
            })
          }

          // Sort by collector number (numeric where possible)
          collectorChoices.sort((a, b) => {
            const numA = parseInt(a.value.num) || 0
            const numB = parseInt(b.value.num) || 0
            if (numA !== numB) return numA - numB
            return a.value.num.localeCompare(b.value.num)
          })

          choices = [
            ...(lastAddedCard
              ? [
                  {
                    title: `➕ Add Another Copy (${lastAddedCard.name})`,
                    value: '__ADD_ANOTHER__',
                  },
                ]
              : []),
            {
              title: `📦 Manage Set Codes (Active: ${activeSet.toUpperCase() || 'none'})`,
              value: '__MANAGE_SETS__',
            },
            { title: '🔤 Switch to Name Mode', value: '__NAME_MODE__' },
            ...(lastAddedCard
              ? [
                  {
                    title: `✏️  Edit Previous Card (${lastAddedCard.name})`,
                    value: '__EDIT_LAST__',
                  },
                ]
              : []),
            ...collectorChoices,
          ]
        }

        const streakHint: string =
          lastAddedCard && lastAddedCount > 0 ? ` (${lastAddedCount}x ${lastAddedCard.name})` : ''
        const promptMessage: string =
          sessionConfig.entryMode === 'name'
            ? `Enter card name to add${streakHint} (or press ESC to exit)`
            : `Enter collector # for ${sessionConfig.collectorSets[sessionConfig.activeSetIndex]?.toUpperCase() || 'SET'}${streakHint} (or ESC to exit)`

        const response = await prompts({
          type: 'autocomplete',
          name: 'cardName',
          message: promptMessage,
          choices: choices,
          limit: 10,
          suggest: async (rawInput, choices) => {
            const input = String(rawInput)
            if (sessionConfig.entryMode === 'name') {
              // Name mode suggestion logic
              const isForce = input.endsWith('!')
              const cleanInput = isForce ? input.slice(0, -1) : input

              if (!cleanInput)
                return choices.filter(
                  (c) =>
                    c.value === '__ADD_ANOTHER__' ||
                    c.value === '__CONFIG__' ||
                    c.value === '__EDIT_LAST__' ||
                    c.value === '__COLLECTOR_MODE__',
                )

              const terms = cleanInput.toLowerCase().split(/\s+/).filter(Boolean)

              const matches = choices.filter((choice) => {
                const title = choice.title.toLowerCase()
                return terms.every((term) => title.includes(term))
              })

              if (isForce) {
                return matches.map((m) => ({
                  ...m,
                  title: `${m.title} (Force Options)`,
                  value: `${m.value}__FORCE__`,
                }))
              }

              return matches
            } else {
              // Collector number mode suggestion logic
              if (!input)
                return choices.filter(
                  (c) =>
                    c.value === '__ADD_ANOTHER__' ||
                    c.value === '__MANAGE_SETS__' ||
                    c.value === '__EDIT_LAST__' ||
                    c.value === '__NAME_MODE__',
                )

              // Filter by collector number prefix
              return choices.filter((choice) => {
                if (typeof choice.value === 'string') return true // menu items
                return choice.value?.num?.startsWith(input)
              })
            }
          },
          onState: (state) => {
            if (state.exited) {
              isExited = true
            }
          },
        })

        if (isExited) {
          console.log('Exiting collection manager.')
          break
        }

        if (!response.cardName) {
          console.error(`❌ Card not found.`)
          if (sessionConfig.sets && sessionConfig.sets.length > 0) {
            console.warn(
              `(Note: Set filters are active: ${sessionConfig.sets.join(', ')}. The card might exist in a different set.)`,
            )
          }
          continue
        }

        // Handle mode switches
        if (response.cardName === '__ADD_ANOTHER__' && lastAddedCard) {
          try {
            await fs.appendFile(collectionFile, lastAddedCard.line)
            lastAddedCount++
            console.log(`Added: ${lastAddedCard.line.trim()} (${lastAddedCount}x total)`)
          } catch (e) {
            console.error(`Failed to write to file: ${e}`)
          }
          continue
        }

        if (response.cardName === '__COLLECTOR_MODE__') {
          // Switch to collector number mode
          if (sessionConfig.collectorSets.length === 0) {
            // Need to set up sets first
            const setsResponse = await prompts({
              type: 'text',
              name: 'sets',
              message: 'Enter set codes to use (comma-separated, e.g., "FDN, SPG"):',
              validate: (val) => (val.trim().length > 0 ? true : 'At least one set code required'),
            })

            if (!setsResponse.sets) continue

            const setCodes = setsResponse.sets
              .split(',')
              .map((s: string) => s.trim().toLowerCase())
              .filter((s: string) => s.length > 0)

            // Load card data for each set
            console.log('Loading set data...')
            for (const setCode of setCodes) {
              console.log(`Loading ${setCode.toUpperCase()}...`)
              const cardMap = await getCardsBySet(setCode)
              sessionConfig.setCardMaps.set(setCode.toLowerCase(), cardMap)
              console.log(`  ${cardMap.size} cards loaded`)
            }

            sessionConfig.collectorSets = setCodes
            sessionConfig.activeSetIndex = 0
          }

          sessionConfig.entryMode = 'collector'
          console.log(
            `Switched to collector number mode. Active set: ${sessionConfig.collectorSets[sessionConfig.activeSetIndex]?.toUpperCase()}`,
          )
          continue
        }

        if (response.cardName === '__NAME_MODE__') {
          sessionConfig.entryMode = 'name'
          console.log('Switched to name mode.')
          continue
        }

        if (response.cardName === '__MANAGE_SETS__') {
          await manageSetCodes(sessionConfig)
          continue
        }

        if (response.cardName === '__CONFIG__') {
          const configResponse = await prompts([
            {
              type: 'text',
              name: 'sets',
              message: 'Filter by Set Codes (comma separated, e.g. "ECL, ECC"):',
              initial: sessionConfig.sets ? sessionConfig.sets.join(', ') : '',
              format: (val) =>
                val
                  .split(',')
                  .map((s: string) => s.trim().toLowerCase())
                  .filter((s: string) => s.length > 0),
            },
            {
              type: 'select',
              name: 'finish',
              message: 'Default Finish:',
              choices: [
                { title: 'None (Always Prompt)', value: '' },
                { title: 'Nonfoil', value: 'nonfoil' },
                { title: 'Foil', value: 'foil' },
                { title: 'Etched', value: 'etched' },
              ],
              initial: sessionConfig.finish
                ? ['', 'nonfoil', 'foil', 'etched'].indexOf(sessionConfig.finish)
                : 0,
            },
            {
              type: 'select',
              name: 'condition',
              message: 'Default Condition:',
              choices: [
                { title: 'None (Always Prompt)', value: '' },
                { title: "Don't Care", value: 'NONE' },
                { title: 'Near Mint', value: 'NM' },
                { title: 'Lightly Played', value: 'LP' },
                { title: 'Moderately Played', value: 'MP' },
                { title: 'Heavily Played', value: 'HP' },
                { title: 'Damaged', value: 'DMG' },
              ],
              initial: 0,
            },
          ])

          if (configResponse.sets !== undefined) {
            sessionConfig.sets = configResponse.sets.length > 0 ? configResponse.sets : undefined
            console.log('Reloading card database with new filters...')
            cardNames = await getAllCardNames({ sets: sessionConfig.sets, excludeDigitalOnly })
            console.log(`Loaded ${cardNames.length} cards.`)
          }

          if (configResponse.finish !== undefined) {
            sessionConfig.finish = configResponse.finish === '' ? undefined : configResponse.finish
          }

          if (configResponse.condition !== undefined) {
            sessionConfig.condition =
              configResponse.condition === '' ? undefined : configResponse.condition
          }

          console.log('Session filters updated.')
          continue
        }

        let cardName: string
        let selectedPrinting: ScryfallCard | null = null

        // Handle collector mode card selection (already has printing info)
        if (
          sessionConfig.entryMode === 'collector' &&
          typeof response.cardName === 'object' &&
          response.cardName.type === 'card'
        ) {
          cardName = response.cardName.card.name
          selectedPrinting = response.cardName.card
        } else {
          // Name mode
          cardName = response.cardName as string

          if (typeof cardName === 'string' && cardName.endsWith('__FORCE__')) {
            cardName = cardName.replace('__FORCE__', '')
            forcePrompts = true
          }

          if (response.cardName === '__EDIT_LAST__' && lastAddedCard) {
            cardName = lastAddedCard.name
            forcePrompts = true
            // Remove last line from file
            try {
              const fileContent = await fs.readFile(collectionFile, 'utf-8')
              const lines = fileContent.trimEnd().split('\n')
              // Verify last line matches what we expect
              if ((lines[lines.length - 1] ?? '').trim() === lastAddedCard.line.trim()) {
                lines.pop()
                await fs.writeFile(collectionFile, lines.join('\n') + '\n')
                console.log(`Editing: ${lastAddedCard.name}`)
              } else {
                console.warn(
                  "Last line in file doesn't match last added card. Proceeding with add as new.",
                )
              }
            } catch (e) {
              console.error(`Failed to prepare edit: ${e}`)
            }
          }
        }

        // If we don't have a printing selected (name mode), fetch printings
        if (!selectedPrinting) {
          // Fetch all printings
          const { getCardPrintings } = await import('../scryfall')
          let printings = await getCardPrintings(cardName)

          // Filter out digital-only printings
          if (excludeDigitalOnly) {
            printings = printings.filter((p) => !isDigitalOnlySet(p.set))
          }

          // Apply Set Filter
          if (sessionConfig.sets && sessionConfig.sets.length > 0) {
            const filtered = printings.filter((p) =>
              sessionConfig.sets!.includes(p.set.toLowerCase()),
            )
            if (filtered.length > 0) {
              printings = filtered
            } else {
              console.warn(
                `No printings found matching set filters [${sessionConfig.sets.join(', ')}]. Showing all printings.`,
              )
            }
          }

          if (printings.length === 0) {
            console.error('No printings found for validation. Using default name.')
            // Append to file as fallback
            try {
              await fs.appendFile(collectionFile, `- ${cardName}\n`)
              console.log(`Added: ${cardName}`)
            } catch (e) {
              console.error(`Failed to write to file: ${e}`)
            }
            continue
          }

          // Prompt for Printing Selection
          selectedPrinting = printings[0]! // Always exists because we checked for 0 above
          if (printings.length > 1) {
            // Sort by Date (newest first) or Set? Let's sort by Set Name approx or just list them.
            // Scryfall bulk data is usually comprehensive.
            // We want to differentiate by set code/name and collector number.

            const printingChoices = printings.map((p) => ({
              title: `${p.set_name} (${p.set.toUpperCase()}) #${p.collector_number} [${p.rarity}]`,
              value: p,
            }))

            const printingResponse = await prompts({
              type: 'autocomplete',
              name: 'printing',
              message: 'Select Printing:',
              choices: printingChoices,
              limit: 15,
              suggest: async (rawInput, choices) => {
                const input = String(rawInput)
                if (!input) return choices

                const terms = input.toLowerCase().split(/\s+/).filter(Boolean)
                const codeMatches: Choice[] = []
                const otherMatches: Choice[] = []

                for (const choice of choices) {
                  const card = choice.value as ScryfallCard
                  const title = choice.title.toLowerCase()
                  if (terms.length === 1 && card?.set?.toLowerCase().startsWith(terms[0]!)) {
                    codeMatches.push(choice)
                  } else if (terms.every((term) => title.includes(term))) {
                    otherMatches.push(choice)
                  }
                }

                return [...codeMatches, ...otherMatches]
              },
            })

            if (!printingResponse.printing) continue // Cancelled
            selectedPrinting = printingResponse.printing
          }
        }

        // Guard: at this point selectedPrinting should be set
        if (!selectedPrinting) {
          console.error('No printing selected.')
          continue
        }

        // Prompt for Finish
        let selectedFinish = 'nonfoil'
        const availableFinishes = selectedPrinting.finishes || []

        if (
          !forcePrompts &&
          sessionConfig.finish &&
          availableFinishes.includes(sessionConfig.finish)
        ) {
          selectedFinish = sessionConfig.finish
        } else if (availableFinishes.length > 1) {
          const finishChoices = availableFinishes.map((f) => ({
            title: f.charAt(0).toUpperCase() + f.slice(1),
            value: f,
          }))
          const finishResponse = await prompts({
            type: 'select',
            name: 'finish',
            message: 'Select Finish:',
            choices: finishChoices,
          })
          if (!finishResponse.finish) continue
          selectedFinish = finishResponse.finish
        } else if (availableFinishes[0]) {
          selectedFinish = availableFinishes[0]
        }

        // Prompt for Condition
        let selectedCondition = ''
        if (!forcePrompts && sessionConfig.condition !== undefined) {
          selectedCondition =
            sessionConfig.condition === 'NONE' ? '' : sessionConfig.condition || ''
        } else {
          const conditionResponse = await prompts({
            type: 'select',
            name: 'condition',
            message: 'Condition:',
            choices: [
              { title: "Don't Care", value: '' },
              { title: 'Near Mint', value: 'NM' },
              { title: 'Lightly Played', value: 'LP' },
              { title: 'Moderately Played', value: 'MP' },
              { title: 'Heavily Played', value: 'HP' },
              { title: 'Damaged', value: 'DMG' },
            ],
          })
          selectedCondition = conditionResponse.condition
        }

        // Construct Output Line
        // Format: - [Card Name] (SET:CN) [Finish] [Condition]
        // E.g. - Sol Ring (C19:221) [foil] [NM]
        let line: string = `- ${cardName} (${selectedPrinting.set.toUpperCase()}:${selectedPrinting.collector_number})`

        if (selectedFinish !== 'nonfoil') {
          line += ` [${selectedFinish}]`
        }

        if (selectedCondition) {
          line += ` [${selectedCondition}]`
        }

        line += '\n'

        // Append to file
        try {
          await fs.appendFile(collectionFile, line)
          console.log(`Added: ${line.trim()}`)
          lastAddedCard = { name: cardName, line: line }
          lastAddedCount = 1
        } catch (e) {
          console.error(`Failed to write to file: ${e}`)
        }
      }
    })
}

/**
 * Submenu for managing set codes in collector number mode
 */
async function manageSetCodes(sessionConfig: {
  collectorSets: string[]
  activeSetIndex: number
  setCardMaps: Map<string, Map<string, ScryfallCard>>
}): Promise<void> {
  while (true) {
    const setChoices: Choice[] = sessionConfig.collectorSets.map((code, idx) => ({
      title: `${idx === sessionConfig.activeSetIndex ? '→ ' : '  '}${code.toUpperCase()}${idx === sessionConfig.activeSetIndex ? ' (active)' : ''}`,
      value: { type: 'toggle', index: idx },
    }))

    setChoices.push(
      { title: '+ Add Set Code', value: { type: 'add' } },
      { title: '- Remove Set Code', value: { type: 'remove' } },
      { title: '← Back', value: { type: 'back' } },
    )

    const response = await prompts({
      type: 'select',
      name: 'action',
      message: 'Manage Set Codes:',
      choices: setChoices,
    })

    if (!response.action || response.action.type === 'back') {
      break
    }

    if (response.action.type === 'toggle') {
      sessionConfig.activeSetIndex = response.action.index
      console.log(
        `Active set changed to: ${sessionConfig.collectorSets[sessionConfig.activeSetIndex]?.toUpperCase()}`,
      )
      break // Return to main loop with new active set
    }

    if (response.action.type === 'add') {
      const addResponse = await prompts({
        type: 'text',
        name: 'code',
        message: 'Enter set code to add:',
        validate: (val) => (val.trim().length > 0 ? true : 'Set code cannot be empty'),
      })

      if (addResponse.code) {
        const newCode = addResponse.code.trim().toLowerCase()
        if (!sessionConfig.collectorSets.includes(newCode)) {
          console.log(`Loading ${newCode.toUpperCase()}...`)
          const cardMap = await getCardsBySet(newCode)
          sessionConfig.setCardMaps.set(newCode, cardMap)
          sessionConfig.collectorSets.push(newCode)
          console.log(`  ${cardMap.size} cards loaded`)
        } else {
          console.log(`Set ${newCode.toUpperCase()} already added.`)
        }
      }
    }

    if (response.action.type === 'remove') {
      if (sessionConfig.collectorSets.length === 0) {
        console.log('No sets to remove.')
        continue
      }

      const removeResponse = await prompts({
        type: 'select',
        name: 'code',
        message: 'Select set to remove:',
        choices: sessionConfig.collectorSets.map((code) => ({
          title: code.toUpperCase(),
          value: code,
        })),
      })

      if (removeResponse.code) {
        const idx = sessionConfig.collectorSets.indexOf(removeResponse.code)
        if (idx !== -1) {
          sessionConfig.collectorSets.splice(idx, 1)
          sessionConfig.setCardMaps.delete(removeResponse.code)
          // Adjust active index if needed
          if (sessionConfig.activeSetIndex >= sessionConfig.collectorSets.length) {
            sessionConfig.activeSetIndex = Math.max(0, sessionConfig.collectorSets.length - 1)
          }
          console.log(`Removed ${removeResponse.code.toUpperCase()}`)
        }
      }
    }
  }
}
