import { Command } from 'commander'
import path from 'path'
import { importFromTextFile } from '../importers/text-file'
import { getDeckPricing } from '../prices'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
} from './scripting'

export function registerPriceCommand(program: Command) {
  addScriptingOptions(
    program
      .command('price')
      .description('Get pricing for a deck (Latest, Min, Max)')
      .argument('<deckName>', 'Name of the deck file (without extension)')
      .option('--all', 'Include all sections (Sideboard, Maybeboard, etc)')
      .option('--with-sideboard', 'Include Sideboard')
      .option('--with-maybeboard', 'Include Maybeboard'),
    'text',
  ).action(async (deckName, options) => {
    const scriptingOptions = normalizeScriptingOptions(options, 'text')
    const decksDir = path.join(process.cwd(), 'decks')
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
      const pricingResult = await getDeckPricing(allCards)

      let grandTotalLatest = 0
      let grandTotalMin = 0
      let grandTotalMax = 0
      const sectionResults: Array<{ name: string; latest: number; min: number; max: number }> = []

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
          console.log(`  Latest: $${sectLatest.toFixed(2)}`)
          console.log(`  Min:    $${sectMin.toFixed(2)}`)
          console.log(`  Max:    $${sectMax.toFixed(2)}`)
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
          },
          scriptingOptions,
        )
        return
      }

      console.log('\n------------------------------')
      console.log(`TOTAL (${sectionsToPrice.map((s) => s.name).join('+')})`)
      console.log(`Latest: $${grandTotalLatest.toFixed(2)}`)
      console.log(`Min:    $${grandTotalMin.toFixed(2)}`)
      console.log(`Max:    $${grandTotalMax.toFixed(2)}`)
      console.log('------------------------------')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to calculate price.'
      emitError('runtime_error', message, scriptingOptions, e)
      process.exitCode = ExitCode.RuntimeError
    }
  })
}
