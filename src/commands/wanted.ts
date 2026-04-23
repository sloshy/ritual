import { Command } from 'commander'
import prompts, { type Choice } from 'prompts'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { getAllCardNames, getCardsBySet, getCardPrintings } from '../scryfall'
import type { ScryfallCard } from '../types'
import { getBaseDir } from '../base-dir'
import { resolveCardPrinting, manageSetCodes, replaceLastLine } from './collection-helpers'
import {
  type WantedListSessionConfig,
  ensureWantedListFile,
  formatWantedListLine,
  promptWantedListConfigUpdate,
  promptWantedFinish,
  isFinish,
} from './wanted-helpers'
import { appendChangelog } from '../changelog-writer'
import { createAddChange } from '../change-event'
import type { ChangeEvent } from '../change-event'
import { allocateNextIdFromContent } from '../card-id'
import { trackAdd, trackEdit, trackAnotherCopy } from '../session-changelog'
import { appendFileWithHash, writeFileWithHash } from '../content-hash'
import {
  findCheapestPrinting,
  formatSpecificPrintingPrice,
  formatCheapestPrintingDisplay,
} from '../price-currency'

export function registerWantedListCommand(program: Command) {
  program
    .command('wanted-list')
    .alias('wanted')
    .description('Manage your wanted list of cards to acquire')
    .option('-s, --sets <codes>', 'Filter by set codes (comma-separated, e.g., "FDN, SPG")')
    .option('-f, --finish <finish>', 'Default finish (nonfoil, foil, etched)')
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

      // Ensure wanted directory exists
      const wantedListsDir = path.join(getBaseDir(), 'wanted')
      await fs.mkdir(wantedListsDir, { recursive: true })

      // List existing wanted lists
      const files = await fs.readdir(wantedListsDir)
      const existingLists = files
        .filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))
        .map((f) => f.replace('.md', ''))

      let selectedList: string

      const selectionResponse = await prompts({
        type: 'autocomplete',
        name: 'list',
        message: 'Select a wanted list file',
        choices: [
          ...existingLists.map((c) => ({ title: c, value: c })),
          { title: '+ Create New Wanted List', value: '__NEW__' },
        ],
      })

      if (!selectionResponse.list) {
        return
      }

      if (selectionResponse.list === '__NEW__') {
        const nameResponse = await prompts({
          type: 'text',
          name: 'name',
          message: 'Enter name for new wanted list:',
          validate: (value) => (value.length > 0 ? true : 'Name cannot be empty'),
        })

        if (!nameResponse.name) return
        selectedList = nameResponse.name
      } else {
        selectedList = selectionResponse.list
      }

      const listFile = await ensureWantedListFile(selectedList)

      const sessionConfig: WantedListSessionConfig = {
        sets: parsedSets,
        finish: isFinish(options.finish) ? options.finish : undefined,
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

      type LastAddedCard = { name: string; line: string; hasNote: boolean; cardId?: number }
      let lastAddedCard: LastAddedCard | null = null
      let lastAddedCount = 0
      const sessionChanges: ChangeEvent[] = []
      let lastChangeIndex: number | null = null

      while (true) {
        let isExited = false
        let isEditing = false

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
            { title: '🔢 Switch to Collector Number Mode', value: '__COLLECTOR_MODE__' },          {
            title:
              sessionChanges.length > 0
                ? `✅ Done — Save ${sessionChanges.length} addition(s)`
                : '✅ Done',
            value: '__DONE__',
          },
          { title: '🚪 Exit Without Saving', value: '__EXIT__' },            ...(lastAddedCard
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
          const activeSet = sessionConfig.collectorSets[sessionConfig.activeSetIndex] || ''
          const setCardMap = sessionConfig.setCardMaps.get(activeSet.toLowerCase()) || new Map()

          const collectorChoices: Choice[] = []
          for (const [num, card] of setCardMap) {
            collectorChoices.push({
              title: `${num} - ${card.name}`,
              value: { type: 'card', num, card },
            })
          }

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
            {
              title:
                sessionChanges.length > 0
                  ? `✅ Done — Save ${sessionChanges.length} addition(s)`
                  : '✅ Done',
              value: '__DONE__',
            },
            { title: '🚪 Exit Without Saving', value: '__EXIT__' },
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
            ? `Enter card name to add${streakHint}`
            : `Enter collector # for ${sessionConfig.collectorSets[sessionConfig.activeSetIndex]?.toUpperCase() || 'SET'}${streakHint}`

        const response = await prompts({
          type: 'autocomplete',
          name: 'cardName',
          message: promptMessage,
          choices: choices,
          limit: 10,
          suggest: async (rawInput, choices) => {
            const input = String(rawInput)
            if (sessionConfig.entryMode === 'name') {
              if (!input)
                return choices.filter(
                  (c) =>
                    c.value === '__ADD_ANOTHER__' ||
                    c.value === '__ADD_NOTE__' ||
                    c.value === '__CONFIG__' ||
                    c.value === '__EDIT_LAST__' ||
                    c.value === '__COLLECTOR_MODE__' ||
                    c.value === '__DONE__' ||
                    c.value === '__EXIT__',
                )

              const terms = input.toLowerCase().split(/\s+/).filter(Boolean)
              return choices.filter((choice) => {
                const title = choice.title.toLowerCase()
                return terms.every((term) => title.includes(term))
              })
            } else {
              if (!input)
                return choices.filter(
                  (c) =>
                    c.value === '__ADD_ANOTHER__' ||
                    c.value === '__ADD_NOTE__' ||
                    c.value === '__MANAGE_SETS__' ||
                    c.value === '__EDIT_LAST__' ||
                    c.value === '__NAME_MODE__' ||
                    c.value === '__DONE__' ||
                    c.value === '__EXIT__',
                )

              return choices.filter((choice) => {
                if (typeof choice.value === 'string') return true
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
            await appendChangelog(listFile, selectedList, sessionChanges)
            console.log('Changelog saved.')
          }
          console.log('Exiting wanted list manager.')
          break
        }

        if (response.cardName === '__DONE__') {
          if (sessionChanges.length > 0) {
            await appendChangelog(listFile, selectedList, sessionChanges)
            console.log('Changelog saved.')
          }
          console.log('Exiting wanted list manager.')
          break
        }

        if (response.cardName === '__EXIT__') {
          if (sessionChanges.length > 0) {
            const confirmResponse = await prompts({
              type: 'confirm',
              name: 'confirm',
              message: `Are you sure you want to exit and lose ${sessionChanges.length} change(s)?`,
              initial: false,
            })
            if (!confirmResponse.confirm) continue
          }
          console.log('Exiting wanted list manager.')
          break
        }

        if (!response.cardName) {
          console.error(`❌ Card not found.`)
          continue
        }

        // Handle mode switches
        if (response.cardName === '__ADD_ANOTHER__' && lastAddedCard) {
          try {
            const fileContent = await fs.readFile(listFile, 'utf-8')
            const { nextId: cardId } = allocateNextIdFromContent(fileContent)
            const lineWithoutId = lastAddedCard.line.trimEnd().replace(/\s*&\d+$/, '')
            const newLine = `${lineWithoutId} &${cardId}\n`
            await appendFileWithHash(listFile, newLine)
            lastAddedCount++
            console.log(`Added: ${newLine.trim()} (${lastAddedCount}x total)`)
            const newIdx = trackAnotherCopy(sessionChanges, lastChangeIndex, cardId)
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
              const fileContent = await fs.readFile(listFile, 'utf-8')
              const lines = fileContent.trimEnd().split('\n')
              if ((lines[lines.length - 1] ?? '').trim() === lastAddedCard.line.trim()) {
                const lineWithoutId: string = lastAddedCard.line.trimEnd().replace(/\s*&\d+$/, '')
                const idSuffix: string =
                  lastAddedCard.cardId !== undefined ? ` &${lastAddedCard.cardId}` : ''
                const newLine: string = `${lineWithoutId} {${note}}${idSuffix}`
                lines[lines.length - 1] = newLine
                await writeFileWithHash(listFile, lines.join('\n') + '\n')
                lastAddedCard = {
                  name: lastAddedCard.name,
                  line: newLine + '\n',
                  hasNote: true,
                  cardId: lastAddedCard.cardId,
                }
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
          cardNames = await promptWantedListConfigUpdate(sessionConfig, excludeDigitalOnly)
          continue
        }

        let cardName: string
        let selectedPrinting: ScryfallCard | null = null

        // Handle collector mode card selection
        if (
          sessionConfig.entryMode === 'collector' &&
          typeof response.cardName === 'object' &&
          response.cardName.type === 'card'
        ) {
          cardName = response.cardName.card.name
          selectedPrinting = response.cardName.card
        } else {
          cardName = response.cardName as string

          if (response.cardName === '__EDIT_LAST__' && lastAddedCard) {
            cardName = lastAddedCard.name
            isEditing = true
            console.log(`Editing: ${lastAddedCard.name}`)
          }
        }

        // Prompt for specificity level
        const specificityResponse = await prompts({
          type: 'select',
          name: 'specificity',
          message: `How specific for ${cardName}?`,
          choices: [
            { title: 'Name only (cheapest printing)', value: 'name-only' },
            { title: 'Choose specific printing', value: 'specific' },
          ],
        })

        if (!specificityResponse.specificity) continue

        if (specificityResponse.specificity === 'name-only') {
          // When editing, preserve the existing ID; only allocate fresh for new adds
          const nameOnlyCardId: number =
            isEditing && lastAddedCard?.cardId !== undefined
              ? lastAddedCard.cardId
              : allocateNextIdFromContent(await fs.readFile(listFile, 'utf-8')).nextId
          const line = formatWantedListLine(
            cardName,
            undefined,
            undefined,
            undefined,
            nameOnlyCardId,
          )
          const nameOnlyEvent: ChangeEvent = createAddChange(cardName, {
            cardId: nameOnlyCardId,
          })

          if (isEditing && lastAddedCard) {
            const result = await replaceLastLine(listFile, lastAddedCard.line, line)
            if (result.replaced) {
              console.log(`Edited: ${line.trim()}`)
            } else {
              console.warn("Last line in file doesn't match last added card. Adding as new entry.")
              await appendFileWithHash(listFile, line)
              console.log(`Added: ${line.trim()}`)
            }
            lastChangeIndex = trackEdit(
              sessionChanges,
              lastChangeIndex,
              nameOnlyEvent,
              result.replaced,
            )
          } else {
            await appendFileWithHash(listFile, line)
            console.log(`Added: ${line.trim()}`)
            const nameOnlyPrintings = await getCardPrintings(cardName)
            console.log(formatCheapestPrintingDisplay(findCheapestPrinting(nameOnlyPrintings)))
            lastChangeIndex = trackAdd(sessionChanges, nameOnlyEvent)
          }
          lastAddedCard = { name: cardName, line: line, hasNote: false, cardId: nameOnlyCardId }
          lastAddedCount = 1
          continue
        }

        // Specific printing flow
        if (!selectedPrinting) {
          const result = await resolveCardPrinting(cardName, sessionConfig, excludeDigitalOnly)
          if (!result) {
            if (isEditing) continue
            console.error('No printings found. Adding name only.')
            const fallbackFileContent = await fs.readFile(listFile, 'utf-8')
            const { nextId: fallbackCardId } = allocateNextIdFromContent(fallbackFileContent)
            const line = formatWantedListLine(
              cardName,
              undefined,
              undefined,
              undefined,
              fallbackCardId,
            )
            await appendFileWithHash(listFile, line)
            console.log(`Added: ${line.trim()}`)
            const fallbackPrintings = await getCardPrintings(cardName)
            console.log(formatCheapestPrintingDisplay(findCheapestPrinting(fallbackPrintings)))
            lastAddedCard = { name: cardName, line: line, hasNote: false, cardId: fallbackCardId }
            lastAddedCount = 1
            lastChangeIndex = trackAdd(
              sessionChanges,
              createAddChange(cardName, { cardId: fallbackCardId }),
            )
            continue
          }
          selectedPrinting = result.printing
        }

        if (!selectedPrinting) {
          console.error('No printing selected.')
          continue
        }

        // Prompt for finish (with "No preference" option for wanted lists)
        const finishResult = await promptWantedFinish(selectedPrinting, sessionConfig.finish)
        if (finishResult === 'cancelled') continue

        const finish = finishResult === 'nopreference' ? undefined : finishResult
        // When editing, preserve the existing ID; only allocate fresh for new adds
        const printingCardId: number =
          isEditing && lastAddedCard?.cardId !== undefined
            ? lastAddedCard.cardId
            : allocateNextIdFromContent(await fs.readFile(listFile, 'utf-8')).nextId
        const line = formatWantedListLine(
          cardName,
          {
            set: selectedPrinting.set,
            collectorNumber: selectedPrinting.collector_number,
          },
          finish,
          undefined,
          printingCardId,
        )

        const printingEvent: ChangeEvent = createAddChange(cardName, {
          set: selectedPrinting.set.toLowerCase(),
          collectorNumber: selectedPrinting.collector_number,
          finish: finish,
          cardId: printingCardId,
        })

        if (isEditing && lastAddedCard) {
          try {
            const result = await replaceLastLine(listFile, lastAddedCard.line, line)
            if (result.replaced) {
              console.log(`Edited: ${line.trim()}`)
            } else {
              console.warn("Last line in file doesn't match last added card. Adding as new entry.")
              await appendFileWithHash(listFile, line)
              console.log(`Added: ${line.trim()}`)
            }
            lastChangeIndex = trackEdit(
              sessionChanges,
              lastChangeIndex,
              printingEvent,
              result.replaced,
            )
            lastAddedCard = { name: cardName, line: line, hasNote: false, cardId: printingCardId }
            lastAddedCount = 1
          } catch (e) {
            console.error(`Failed to edit card: ${e}`)
          }
        } else {
          try {
            await appendFileWithHash(listFile, line)
            console.log(`Added: ${line.trim()}`)
            console.log(formatSpecificPrintingPrice(selectedPrinting, finish))
            lastAddedCard = { name: cardName, line: line, hasNote: false, cardId: printingCardId }
            lastAddedCount = 1
            lastChangeIndex = trackAdd(sessionChanges, printingEvent)
          } catch (e) {
            console.error(`Failed to write to file: ${e}`)
          }
        }
      }
    })
}
