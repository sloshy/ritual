import { Command } from 'commander'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { getCardPrintings } from '../scryfall'
import type { ScryfallCard } from '../types'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
} from './scripting'

export type CollectionEntry = {
  name: string
  quantity: number
  set: string
  collectorNumber: string
  finish?: string
  condition?: string
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
      /^- (.+?)(?:\s\(([A-Za-z0-9]+):([A-Za-z0-9-]+)\))?(?:\s\[(nonfoil|foil|etched)\])?(?:\s\[(NM|LP|MP|HP|DMG)\])?$/,
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
    })
  }
  return { entries, warnings }
}

function getPriceForFinish(card: ScryfallCard, finish: string): number {
  let raw: string | null = null
  if (finish === 'foil') {
    raw = card.prices.usd_foil
  } else if (finish === 'etched') {
    raw = card.prices.usd_etched
  } else {
    raw = card.prices.usd
  }
  if (raw !== null) {
    const parsed = parseFloat(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function resolveFinish(entry: CollectionEntry, card: ScryfallCard): string {
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
      .option('--descending', 'Reverse the sort direction'),
    'text',
  ).action(async (collectionName: string | undefined, options) => {
    const scriptingOptions = normalizeScriptingOptions(options, 'text')
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
          const price = getPriceForFinish(exactPrinting, finish)
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
          pricedCards.sort((a, b) => a.price - b.price)
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
              card.quantity > 1 ? ` ($${(card.price * card.quantity).toFixed(2)} total)` : ''
            console.log(
              `  ${card.name} (${card.set.toUpperCase()}:${card.collectorNumber})${finishTag}${qty} — $${card.price.toFixed(2)}${totalSuffix}`,
            )
          }

          console.log('')
          const stats: string[] = [`${totalCards} cards`]
          if (foilCount > 0) stats.push(`${foilCount} foil`)
          if (etchedCount > 0) stats.push(`${etchedCount} etched`)
          console.log(`  ${stats.join(', ')}`)
          console.log(`  Total: $${fileTotal.toFixed(2)}`)
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
        console.log(`Total: $${grandTotal.toFixed(2)}`)
        console.log('------------------------------')
      }

      console.log(
        '\n⚠️  Disclaimer: Prices are from Scryfall and reflect NM (Near Mint) market values. Card condition (LP, MP, HP, DMG) can significantly decrease actual value.',
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to calculate collection price.'
      emitError('runtime_error', message, scriptingOptions, e)
      process.exitCode = ExitCode.RuntimeError
    }
  })
}
