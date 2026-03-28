import { Command } from 'commander'
import prompts, { type Choice } from 'prompts'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { getAllCardNames, getCardsBySet } from '../scryfall'
import type { ScryfallCard } from '../types'
import {
  type SessionConfig,
  resolveCardPrinting,
  promptFinishAndCondition,
  formatCollectionLine,
  promptConfigUpdate,
  manageSetCodes,
  replaceLastLine,
  ensureCollectionFile,
  isFinish,
  isCondition,
} from './collection-helpers'
import { appendChangelog } from '../changelog-writer'
import { createChangeEvent } from '../change-event'
import type { ChangeEvent } from '../change-event'
import { trackAdd, trackEdit, trackAnotherCopy } from '../session-changelog'

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
        return
      }

      console.log(`Loaded ${cardNames.length} cards.`)

      // Ensure collections directory exists
      const collectionsDir = path.join(process.cwd(), 'collections')
      await fs.mkdir(collectionsDir, { recursive: true })

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

      const collectionFile = await ensureCollectionFile(selectedCollection)

      const sessionConfig: SessionConfig = {
        sets: parsedSets,
        finish: isFinish(options.finish) ? options.finish : undefined,
        condition: isCondition(options.condition?.toUpperCase())
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

      type LastAddedCard = { name: string; line: string; hasNote: boolean }
      let lastAddedCard: LastAddedCard | null = null
      let lastAddedCount = 0
      const sessionChanges: ChangeEvent[] = []
      let lastChangeIndex: number | null = null

      while (true) {
        let isExited = false
        let forcePrompts = false
        let isEditing = false

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
            ...(lastAddedCard && !lastAddedCard.hasNote
              ? [
                  {
                    title: `📝 Add Note (${lastAddedCard.name})`,
                    value: '__ADD_NOTE__',
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
            ...(lastAddedCard && !lastAddedCard.hasNote
              ? [
                  {
                    title: `📝 Add Note (${lastAddedCard.name})`,
                    value: '__ADD_NOTE__',
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
                    c.value === '__ADD_NOTE__' ||
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
                    c.value === '__ADD_NOTE__' ||
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
          if (sessionChanges.length > 0) {
            await appendChangelog(collectionFile, selectedCollection, sessionChanges)
            console.log('Changelog saved.')
          }
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
            const newIdx = trackAnotherCopy(sessionChanges, lastChangeIndex)
            if (newIdx !== null) lastChangeIndex = newIdx
          } catch (e) {
            console.error(`Failed to write to file: ${e}`)
          }
          continue
        }

        if (response.cardName === '__ADD_NOTE__' && lastAddedCard) {
          const noteResponse = await prompts({
            type: 'text',
            name: 'note',
            message: 'Enter note:',
          })
          const note = noteResponse.note?.trim()
          if (note) {
            try {
              const fileContent = await fs.readFile(collectionFile, 'utf-8')
              const lines = fileContent.trimEnd().split('\n')
              if ((lines[lines.length - 1] ?? '').trim() === lastAddedCard.line.trim()) {
                const newLine: string = lastAddedCard.line.trimEnd() + ` {${note}}`
                lines[lines.length - 1] = newLine
                await fs.writeFile(collectionFile, lines.join('\n') + '\n')
                lastAddedCard = { name: lastAddedCard.name, line: newLine + '\n', hasNote: true }
                console.log(`Note added: ${newLine}`)
              } else {
                console.warn("Last line in file doesn't match last added card. Note not added.")
              }
            } catch (e) {
              console.error(`Failed to add note: ${e}`)
            }
          }
          continue
        }

        if (response.cardName === '__COLLECTOR_MODE__') {
          if (sessionConfig.collectorSets.length === 0) {
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
          cardNames = await promptConfigUpdate(sessionConfig, excludeDigitalOnly)
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
            isEditing = true
            console.log(`Editing: ${lastAddedCard.name}`)
          }
        }

        // If we don't have a printing selected (name mode), fetch printings
        if (!selectedPrinting) {
          const result = await resolveCardPrinting(cardName, sessionConfig, excludeDigitalOnly)
          if (!result) {
            if (isEditing) continue
            console.error('No printings found for validation. Using default name.')
            try {
              await fs.appendFile(collectionFile, `- ${cardName}\n`)
              console.log(`Added: ${cardName}`)
              lastAddedCard = { name: cardName, line: `- ${cardName}\n`, hasNote: false }
              lastAddedCount = 1
              lastChangeIndex = trackAdd(sessionChanges, createChangeEvent('add', cardName))
            } catch (e) {
              console.error(`Failed to write to file: ${e}`)
            }
            continue
          }
          selectedPrinting = result.printing
        }

        // Guard: at this point selectedPrinting should be set
        if (!selectedPrinting) {
          console.error('No printing selected.')
          continue
        }

        const finishAndCondition = await promptFinishAndCondition(
          selectedPrinting,
          sessionConfig,
          forcePrompts,
        )
        if (!finishAndCondition) continue

        const line = formatCollectionLine(
          cardName,
          selectedPrinting,
          finishAndCondition.finish,
          finishAndCondition.condition,
        )

        const cardChangeEvent: ChangeEvent = createChangeEvent('add', cardName, {
          set: selectedPrinting.set.toLowerCase(),
          collectorNumber: selectedPrinting.collector_number,
          finish: finishAndCondition.finish,
          condition: finishAndCondition.condition,
        })

        // Remove old line when editing, then append new line
        if (isEditing && lastAddedCard) {
          try {
            const result = await replaceLastLine(collectionFile, lastAddedCard.line, line)
            if (result.replaced) {
              console.log(`Edited: ${line.trim()}`)
            } else {
              console.warn("Last line in file doesn't match last added card. Adding as new entry.")
              await fs.appendFile(collectionFile, line)
              console.log(`Added: ${line.trim()}`)
            }
            lastChangeIndex = trackEdit(
              sessionChanges,
              lastChangeIndex,
              cardChangeEvent,
              result.replaced,
            )
            lastAddedCard = { name: cardName, line: line, hasNote: false }
            lastAddedCount = 1
          } catch (e) {
            console.error(`Failed to edit card: ${e}`)
          }
        } else {
          // Append to file
          try {
            await fs.appendFile(collectionFile, line)
            console.log(`Added: ${line.trim()}`)
            lastAddedCard = { name: cardName, line: line, hasNote: false }
            lastAddedCount = 1
            lastChangeIndex = trackAdd(sessionChanges, cardChangeEvent)
          } catch (e) {
            console.error(`Failed to write to file: ${e}`)
          }
        }
      }
    })
}
