import { Command } from 'commander'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { getCardPrintings, getCardGames } from '../scryfall'
import type { ScryfallCard } from '../types'
import {
  parseCurrencyFlagOrError,
  formatPrice,
  getCardPriceForFinish,
  isCurrencyAvailableForCard,
} from '../price-currency'
import type { PriceCurrency } from '../price-currency'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
} from './scripting'
import { getErrorMessage } from '../errors'

export type CollectionEntry = {
  name: string
  quantity: number
  set: string
  collectorNumber: string
  finish?: string
  condition?: string
  note?: string
}

export type CollectionParseResult = {
  entries: CollectionEntry[]
  warnings: string[]
}

export function parseCollectionFile(content: string): CollectionParseResult {
  const entries: CollectionEntry[] = []
  const warnings: string[] = []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('- ')) continue

    const match = trimmed.match(
      /^- (.+?)(?:\s\(([A-Za-z0-9]+):([^)]+)\))?(?:\s\[(nonfoil|foil|etched)\])?(?:\s\[(NM|LP|MP|HP|DMG)\])?(?:\s\{(.+)\})?$/,
    )
    if (!match) continue

    const name = match[1]!
    const setCode = match[2]
    const collectorNumber = match[3]

    if (!setCode || !collectorNumber) {
      warnings.push(`Skipping '${name}': missing set code and collector number`)
      continue
    }

    entries.push({
      name,
      quantity: 1,
      set: setCode,
      collectorNumber,
      finish: match[4],
      condition: match[5],
      note: match[6],
    })
  }
  return { entries, warnings }
}

export function getPriceForFinish(
  card: ScryfallCard,
  finish: string,
  currency: PriceCurrency = 'usd',
): number {
  return getCardPriceForFinish(card, finish, currency)
}

export function resolveFinish(entry: CollectionEntry, card: ScryfallCard): string {
  if (entry.finish) return entry.finish
  if (card.finishes.includes('nonfoil')) return 'nonfoil'
  return card.finishes[0] ?? 'nonfoil'
}

export function registerPriceCollectionCommand(program: Command) {
  addScriptingOptions(
    program
      .command('price-collection')
      .description('Get pricing for your collection')
      .argument('[collectionName]', 'Name of a single collection file (without extension)')
      .alias('pc')
      .option('--sort <field>', 'Sort cards by field (name, price)', '')
      .option('--descending', 'Reverse the sort direction')
      .option('--prices <currency>', 'Price currency: usd, eur, or tix (default: usd)'),
    'text',
  ).action(async (collectionName: string | undefined, options) => {
    const scriptingOptions = normalizeScriptingOptions(options, 'text')

    const currency = parseCurrencyFlagOrError(
      options.prices,
      emitError,
      scriptingOptions,
      ExitCode.UsageError,
    )
    if (!currency) return

    const collectionsDir = path.join(process.cwd(), 'collections')

    try {
      await fs.access(collectionsDir)
    } catch {
      emitError('not_found', 'No collections/ directory found.', scriptingOptions)
      process.exitCode = ExitCode.NotFound
      return
    }

    let filesToPrice: string[]

    if (collectionName) {
      const fileName = collectionName.endsWith('.md') ? collectionName : `${collectionName}.md`
      const filePath = path.join(collectionsDir, fileName)
      try {
        await fs.access(filePath)
      } catch {
        emitError(
          'not_found',
          `Collection file '${fileName}' not found in collections/ directory.`,
          scriptingOptions,
        )
        process.exitCode = ExitCode.NotFound
        return
      }
      filesToPrice = [fileName]
    } else {
      const allFiles = await fs.readdir(collectionsDir)
      filesToPrice = allFiles.filter((f) => f.endsWith('.md'))
      if (filesToPrice.length === 0) {
        emitError(
          'not_found',
          'No collection files found in collections/ directory.',
          scriptingOptions,
        )
        process.exitCode = ExitCode.NotFound
        return
      }
    }

    try {
      type PricedCard = {
        name: string
        set: string
        collectorNumber: string
        finish: string
        price: number
        quantity: number
      }

      type CollectionResult = {
        name: string
        cards: PricedCard[]
        totalCards: number
        foilCount: number
        etchedCount: number
        nonfoilCount: number
        total: number
      }

      const collectionResults: CollectionResult[] = []
      let grandTotal = 0

      for (const file of filesToPrice) {
        const filePath = path.join(collectionsDir, file)
        const content = await fs.readFile(filePath, 'utf-8')
        const { entries, warnings } = parseCollectionFile(content)
        const collectionDisplayName = file.replace('.md', '')

        if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
          for (const warning of warnings) {
            console.warn(`⚠️  ${warning}`)
          }
        }

        if (entries.length === 0) {
          if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
            console.log(`\n[${collectionDisplayName}] — no cards found, skipping`)
          }
          continue
        }

        // Aggregate entries by name+set+collector+finish for quantity counting
        const aggregated = new Map<string, CollectionEntry>()
        for (const entry of entries) {
          const key = `${entry.name}|${entry.set}|${entry.collectorNumber}|${entry.finish ?? ''}`
          const existing = aggregated.get(key)
          if (existing) {
            existing.quantity++
          } else {
            aggregated.set(key, { ...entry })
          }
        }

        const pricedCards: PricedCard[] = []
        let fileTotal = 0
        let foilCount = 0
        let etchedCount = 0
        let nonfoilCount = 0

        for (const entry of aggregated.values()) {
          const printings = await getCardPrintings(entry.name)

          // Check game format availability for the selected currency
          const games = getCardGames(printings)
          if (!isCurrencyAvailableForCard(games, currency)) {
            if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
              console.warn(
                `⚠️  '${entry.name}' is not available in ${currency === 'tix' ? 'MTGO' : 'paper'}, skipping ${currency.toUpperCase()} pricing.`,
              )
            }
            continue
          }

          const exactPrinting = printings.find(
            (p) =>
              p.set.toLowerCase() === entry.set.toLowerCase() &&
              p.collector_number === entry.collectorNumber,
          )

          if (!exactPrinting) {
            if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
              console.warn(
                `⚠️  Could not find printing for '${entry.name}' (${entry.set.toUpperCase()}:${entry.collectorNumber})`,
              )
            }
            continue
          }

          const finish = resolveFinish(entry, exactPrinting)
          const price = getPriceForFinish(exactPrinting, finish, currency)
          const lineTotal = price * entry.quantity
          fileTotal += lineTotal

          if (finish === 'foil') foilCount += entry.quantity
          else if (finish === 'etched') etchedCount += entry.quantity
          else nonfoilCount += entry.quantity

          pricedCards.push({
            name: entry.name,
            set: entry.set,
            collectorNumber: entry.collectorNumber,
            finish,
            price,
            quantity: entry.quantity,
          })
        }

        grandTotal += fileTotal
        const totalCards = nonfoilCount + foilCount + etchedCount

        const sortField: string = options.sort || ''
        const descending: boolean = options.descending || false

        if (sortField === 'name') {
          pricedCards.sort((a, b) => a.name.localeCompare(b.name))
        } else if (sortField === 'price') {
          pricedCards.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name))
        }

        if (descending) {
          pricedCards.reverse()
        }

        collectionResults.push({
          name: collectionDisplayName,
          cards: pricedCards,
          totalCards,
          foilCount,
          etchedCount,
          nonfoilCount,
          total: fileTotal,
        })

        if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
          console.log(`\n[${collectionDisplayName}]`)

          for (const card of pricedCards) {
            const qty = card.quantity > 1 ? ` (${card.quantity}x)` : ''
            const finishTag = card.finish !== 'nonfoil' ? ` [${card.finish}]` : ''
            const totalSuffix =
              card.quantity > 1
                ? ` (${formatPrice(card.price * card.quantity, currency)} total)`
                : ''
            console.log(
              `  ${card.name} (${card.set.toUpperCase()}:${card.collectorNumber})${finishTag}${qty} — ${formatPrice(card.price, currency)}${totalSuffix}`,
            )
          }

          console.log('')
          const stats: string[] = [`${totalCards} cards`]
          if (foilCount > 0) stats.push(`${foilCount} foil`)
          if (etchedCount > 0) stats.push(`${etchedCount} etched`)
          console.log(`  ${stats.join(', ')}`)
          console.log(`  Total: ${formatPrice(fileTotal, currency)}`)
        }
      }

      if (scriptingOptions.output === 'json') {
        emitOutput(
          {
            collections: collectionResults,
            total: grandTotal,
          },
          scriptingOptions,
        )
        return
      }

      if (collectionResults.length > 1) {
        console.log('\n------------------------------')
        console.log('TOTAL (all collections)')
        console.log(`Total: ${formatPrice(grandTotal, currency)}`)
        console.log('------------------------------')
      }

      console.log(
        '\n⚠️  Disclaimer: Prices are from Scryfall and reflect NM (Near Mint) market values. Card condition (LP, MP, HP, DMG) can significantly decrease actual value.',
      )
    } catch (e) {
      const message = getErrorMessage(e)
      emitError('runtime_error', message, scriptingOptions, e)
      process.exitCode = ExitCode.RuntimeError
    }
  })
}
