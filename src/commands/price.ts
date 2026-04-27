import { Command } from 'commander'
import path from 'node:path'
import { importFromTextFile } from '../importers/text-file'
import { getDeckPricing } from '../prices'
import { parseCurrencyFlagOrError, formatPrice } from '../price-currency'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'
import { getErrorMessage } from '../errors'
import { getDecksDir } from '../ritual-config'

type SectionPricingResult = {
  name: string
  latest: number
  min: number
  max: number
}

type PriceDeckOptions = {
  all?: boolean
  withSideboard?: boolean
  withMaybeboard?: boolean
  prices?: string
} & Partial<ScriptingOptions>

export function registerPriceDeckCommand(program: Command) {
  addScriptingOptions(
    program
      .command('price-deck')
      .description('Get pricing for a deck (Latest, Min, Max)')
      .argument('<deckName>', 'Name of the deck file (without extension)')
      .option('--all', 'Include all sections (Sideboard, Maybeboard, etc)')
      .option('--with-sideboard', 'Include Sideboard')
      .option('--with-maybeboard', 'Include Maybeboard')
      .option('--prices <currency>', 'Price currency: usd, eur, or tix (default: usd)'),
    'text',
  ).action(async (deckName: string, options: PriceDeckOptions) => {
    const scriptingOptions = normalizeScriptingOptions(options, 'text')

    const currency = parseCurrencyFlagOrError(
      options.prices,
      emitError,
      scriptingOptions,
      ExitCode.UsageError,
    )
    if (!currency) return

    const decksDir = getDecksDir()
    const fileName = deckName.endsWith('.md') ? deckName : `${deckName}.md`
    const filePath = path.join(decksDir, fileName)

    if (!(await Bun.file(filePath).exists())) {
      emitError(
        'not_found',
        `Deck file '${fileName}' not found in decks/ directory.`,
        scriptingOptions,
      )
      process.exitCode = ExitCode.NotFound
      return
    }

    try {
      const deck = await importFromTextFile(filePath)

      // Determine active sections
      // Default: "Main" and "Commander"
      // If --all: all sections.
      // If --with-sideboard: add Sideboard.

      const defaultSections = ['Main', 'Commander']
      const targetSectionNames = new Set(defaultSections)

      if (options.all) {
        // Add all found section names
        deck.sections.forEach((s) => targetSectionNames.add(s.name))
      } else {
        if (options.withSideboard) targetSectionNames.add('Sideboard')
        if (options.withMaybeboard) targetSectionNames.add('Maybeboard')
      }

      // Collect ALL cards from these sections to fetch prices
      const sectionsToPrice = deck.sections.filter((s) => targetSectionNames.has(s.name))
      const allCards = sectionsToPrice.flatMap((s) => s.cards)

      if (allCards.length === 0) {
        emitError('usage_error', 'No cards found in the selected sections.', scriptingOptions)
        process.exitCode = ExitCode.UsageError
        return
      }

      if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
        console.log(`Calculating price for '${deckName}'...`)
        console.log(`Included Sections: ${Array.from(targetSectionNames).join(', ')}`)
      }

      // We pass ALL cards to getDeckPricing to fetch data efficiently
      // It returns a breakdown map (cardName -> prices).
      // We can then calculate per-section totals.
      const pricingResult = await getDeckPricing(allCards, currency)

      // Warn about missing cards
      if (pricingResult.missingCards.length > 0) {
        if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
          console.warn(
            `\n⚠️  ${pricingResult.missingCards.length} card(s) have no ${currency.toUpperCase()} pricing and are omitted from totals:`,
          )
          for (const name of pricingResult.missingCards) {
            console.warn(`   - ${name}`)
          }
        }
      }

      let grandTotalLatest = 0
      let grandTotalMin = 0
      let grandTotalMax = 0
      const sectionResults: SectionPricingResult[] = []

      for (const section of sectionsToPrice) {
        let sectLatest = 0
        let sectMin = 0
        let sectMax = 0

        for (const card of section.cards) {
          const p = pricingResult.breakdown.get(card.name)
          if (p) {
            sectLatest += p.latest * card.quantity
            sectMin += p.min * card.quantity
            sectMax += p.max * card.quantity
          }
        }

        grandTotalLatest += sectLatest
        grandTotalMin += sectMin
        grandTotalMax += sectMax
        sectionResults.push({
          name: section.name,
          latest: sectLatest,
          min: sectMin,
          max: sectMax,
        })

        if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
          console.log(`\n[${section.name}]`)
          console.log(`  Latest: ${formatPrice(sectLatest, currency)}`)
          console.log(`  Min:    ${formatPrice(sectMin, currency)}`)
          console.log(`  Max:    ${formatPrice(sectMax, currency)}`)
        }
      }

      if (scriptingOptions.output === 'json') {
        emitOutput(
          {
            deck: deck.name,
            includedSections: sectionsToPrice.map((s) => s.name),
            sections: sectionResults,
            totals: {
              latest: grandTotalLatest,
              min: grandTotalMin,
              max: grandTotalMax,
            },
            missingCards: pricingResult.missingCards,
          },
          scriptingOptions,
        )
        return
      }

      console.log('\n------------------------------')
      console.log(`TOTAL (${sectionsToPrice.map((s) => s.name).join('+')})`)
      console.log(`Latest: ${formatPrice(grandTotalLatest, currency)}`)
      console.log(`Min:    ${formatPrice(grandTotalMin, currency)}`)
      console.log(`Max:    ${formatPrice(grandTotalMax, currency)}`)
      console.log('------------------------------')
    } catch (e) {
      const message = getErrorMessage(e)
      emitError('runtime_error', message, scriptingOptions, e)
      process.exitCode = ExitCode.RuntimeError
    }
  })
}
