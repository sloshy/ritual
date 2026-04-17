import { Command } from 'commander'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { getCardPrintings, getCardGames, computeRepresentativePrints } from '../scryfall'
import { parseWantedListFile } from './wanted-helpers'
import { getPriceForFinish, resolveFinish } from './price-collection'
import type { CollectionEntry } from './price-collection'
import { getBaseDir } from '../base-dir'
import {
  parseCurrencyFlagOrError,
  formatPrice,
  isCurrencyAvailableForCard,
  getCardPriceForFinish,
} from '../price-currency'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
} from './scripting'
import { getErrorMessage } from '../errors'
import type { WantedListEntryState } from '../site/data-types'

type PricedCard = {
  name: string
  set?: string
  collectorNumber?: string
  finish: string
  latest: number
  min: number
  max: number
  quantity: number
  state: WantedListEntryState
}

type WantedListResult = {
  name: string
  cards: PricedCard[]
  totalCards: number
  totalLatest: number
  totalMin: number
  totalMax: number
}

export function registerPriceWantedListCommand(program: Command) {
  addScriptingOptions(
    program
      .command('price-wanted-list')
      .description('Get pricing for your wanted list')
      .argument('[listName]', 'Name of a single wanted list file (without extension)')
      .alias('pwl')
      .option('--sort <field>', 'Sort cards by field (name, price)', '')
      .option('--descending', 'Reverse the sort direction')
      .option('--prices <currency>', 'Price currency: usd, eur, or tix (default: usd)'),
    'text',
  ).action(async (listName: string | undefined, options) => {
    const scriptingOptions = normalizeScriptingOptions(options, 'text')

    const currency = parseCurrencyFlagOrError(
      options.prices,
      emitError,
      scriptingOptions,
      ExitCode.UsageError,
    )
    if (!currency) return

    const wantedListsDir = path.join(getBaseDir(), 'wanted')

    try {
      await fs.access(wantedListsDir)
    } catch {
      emitError('not_found', 'No wanted/ directory found.', scriptingOptions)
      process.exitCode = ExitCode.NotFound
      return
    }

    let filesToPrice: string[]

    if (listName) {
      const fileName = listName.endsWith('.md') ? listName : `${listName}.md`
      if (fileName.endsWith('.changes.md')) {
        emitError(
          'not_found',
          `'${fileName}' is a changelog file and cannot be priced directly.`,
          scriptingOptions,
        )
        process.exitCode = ExitCode.UsageError
        return
      }
      const filePath = path.join(wantedListsDir, fileName)
      try {
        await fs.access(filePath)
      } catch {
        emitError(
          'not_found',
          `Wanted list file '${fileName}' not found in wanted/ directory.`,
          scriptingOptions,
        )
        process.exitCode = ExitCode.NotFound
        return
      }
      filesToPrice = [fileName]
    } else {
      const allFiles = await fs.readdir(wantedListsDir)
      filesToPrice = allFiles.filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))
      if (filesToPrice.length === 0) {
        emitError('not_found', 'No wanted list files found in wanted/ directory.', scriptingOptions)
        process.exitCode = ExitCode.NotFound
        return
      }
    }

    try {
      const listResults: WantedListResult[] = []
      let grandTotalLatest = 0
      let grandTotalMin = 0
      let grandTotalMax = 0

      for (const file of filesToPrice) {
        const filePath = path.join(wantedListsDir, file)
        const content = await fs.readFile(filePath, 'utf-8')
        const { entries } = parseWantedListFile(content)
        const listDisplayName = file.replace('.md', '')

        if (entries.length === 0) {
          if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
            console.log(`\n[${listDisplayName}] — no cards found, skipping`)
          }
          continue
        }

        const pricedCards: PricedCard[] = []
        let fileLatest = 0
        let fileMin = 0
        let fileMax = 0

        for (const entry of entries) {
          const printings = await getCardPrintings(entry.name)

          const games = getCardGames(printings)
          if (!isCurrencyAvailableForCard(games, currency)) {
            if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
              console.warn(
                `⚠️  '${entry.name}' is not available in ${currency === 'tix' ? 'MTGO' : 'paper'}, skipping ${currency.toUpperCase()} pricing.`,
              )
            }
            continue
          }

          // Determine state
          let state: WantedListEntryState
          if (!entry.set || !entry.collectorNumber) {
            state = 'name-only'
          } else if (!entry.finish) {
            state = 'printing'
          } else {
            state = 'fully-specified'
          }

          let latest = 0
          let min = 0
          let max = 0
          let finish = 'nonfoil'

          if (state === 'name-only') {
            // Use cheapest printing across all printings
            if (printings.length > 0) {
              const sortedByDate = [...printings].sort((a, b) =>
                (b.released_at ?? '').localeCompare(a.released_at ?? ''),
              )
              const repPrints = computeRepresentativePrints(sortedByDate, printings, [currency])
              const rep = repPrints[currency]

              if (rep?.cheapest) {
                const collectionEntry: CollectionEntry = {
                  name: entry.name,
                  quantity: 1,
                  set: rep.cheapest.set,
                  collectorNumber: rep.cheapest.collector_number,
                }
                const cheapFinish = resolveFinish(collectionEntry, rep.cheapest)
                finish = cheapFinish
                latest = getPriceForFinish(rep.cheapest, cheapFinish, currency)
                min = latest
              }

              // Find max price across all printings
              for (const p of printings) {
                for (const f of p.finishes) {
                  const fp = getCardPriceForFinish(p, f, currency)
                  if (fp > max) max = fp
                }
              }

              // Ensure min/max don't have gaps when only one is available
              if (min === 0) min = latest
              if (max === 0) max = latest
            }
          } else {
            // 'printing' or 'fully-specified': find exact printing
            const exactPrinting = printings.find(
              (p) =>
                p.set.toLowerCase() === entry.set!.toLowerCase() &&
                p.collector_number === entry.collectorNumber,
            )

            if (!exactPrinting) {
              if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
                console.warn(
                  `⚠️  Could not find printing for '${entry.name}' (${entry.set!.toUpperCase()}:${entry.collectorNumber})`,
                )
              }
              continue
            }

            if (state === 'fully-specified') {
              finish = entry.finish!
              const price = getPriceForFinish(exactPrinting, finish, currency)
              latest = price
              min = price
              max = price
            } else {
              // State 2: cheapest finish of this printing
              const collectionEntry: CollectionEntry = {
                name: entry.name,
                quantity: 1,
                set: entry.set!,
                collectorNumber: entry.collectorNumber!,
              }
              const defaultFinish = resolveFinish(collectionEntry, exactPrinting)
              latest = getPriceForFinish(exactPrinting, defaultFinish, currency)
              finish = defaultFinish

              // Find cheapest and most expensive finish
              min = latest
              max = latest
              for (const f of exactPrinting.finishes) {
                const fp = getPriceForFinish(exactPrinting, f, currency)
                if (fp > 0 && (fp < min || min === 0)) min = fp
                if (fp > max) max = fp
              }
            }
          }

          fileLatest += latest * entry.quantity
          fileMin += min * entry.quantity
          fileMax += max * entry.quantity

          pricedCards.push({
            name: entry.name,
            set: entry.set,
            collectorNumber: entry.collectorNumber,
            finish,
            latest,
            min,
            max,
            quantity: entry.quantity,
            state,
          })
        }

        grandTotalLatest += fileLatest
        grandTotalMin += fileMin
        grandTotalMax += fileMax

        const sortField: string = options.sort || ''
        const descending: boolean = options.descending || false

        if (sortField === 'name') {
          pricedCards.sort((a, b) => a.name.localeCompare(b.name))
        } else if (sortField === 'price') {
          pricedCards.sort((a, b) => a.latest - b.latest || a.name.localeCompare(b.name))
        }

        if (descending) {
          pricedCards.reverse()
        }

        listResults.push({
          name: listDisplayName,
          cards: pricedCards,
          totalCards: pricedCards.reduce((sum, c) => sum + c.quantity, 0),
          totalLatest: fileLatest,
          totalMin: fileMin,
          totalMax: fileMax,
        })

        if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
          console.log(`\n[${listDisplayName}]`)

          for (const card of pricedCards) {
            const qty = card.quantity > 1 ? ` (${card.quantity}x)` : ''
            const stateTag =
              card.state === 'name-only' ? ' [name only]' : card.state === 'printing' ? '' : ''
            const printingInfo =
              card.set && card.collectorNumber
                ? ` (${card.set.toUpperCase()}:${card.collectorNumber})`
                : ''
            const finishTag =
              card.finish !== 'nonfoil' && card.state !== 'name-only' ? ` [${card.finish}]` : ''
            const totalSuffix =
              card.quantity > 1
                ? ` (${formatPrice(card.latest * card.quantity, currency)} total)`
                : ''
            console.log(
              `  ${card.name}${printingInfo}${finishTag}${stateTag}${qty} — ${formatPrice(card.latest, currency)}${totalSuffix}`,
            )
          }

          console.log('')
          console.log(`  ${pricedCards.length} cards`)
          console.log(`  Latest: ${formatPrice(fileLatest, currency)}`)
          console.log(`  Min:    ${formatPrice(fileMin, currency)}`)
          console.log(`  Max:    ${formatPrice(fileMax, currency)}`)
        }
      }

      if (scriptingOptions.output === 'json') {
        emitOutput(
          {
            wantedLists: listResults,
            totals: {
              latest: grandTotalLatest,
              min: grandTotalMin,
              max: grandTotalMax,
            },
          },
          scriptingOptions,
        )
        return
      }

      if (listResults.length > 1) {
        console.log('\n------------------------------')
        console.log('TOTAL (all wanted lists)')
        console.log(`Latest: ${formatPrice(grandTotalLatest, currency)}`)
        console.log(`Min:    ${formatPrice(grandTotalMin, currency)}`)
        console.log(`Max:    ${formatPrice(grandTotalMax, currency)}`)
        console.log('------------------------------')
      }

      console.log(
        '\n⚠️  Disclaimer: Prices are from Scryfall and reflect NM (Near Mint) market values.',
      )
    } catch (e) {
      const message = getErrorMessage(e)
      emitError('runtime_error', message, scriptingOptions, e)
      process.exitCode = ExitCode.RuntimeError
    }
  })
}
