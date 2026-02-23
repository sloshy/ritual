import { Command } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import { render } from 'preact-render-to-string'
import { importFromTextFile } from '../importers/text-file'
import { fetchCardData, downloadImage } from '../scryfall'
import { IndexPage } from '../site/IndexPage'
import { DeckPage } from '../site/DeckPage'
import { getBundledSiteAssets } from '../site/bundled-assets'
import type { DeckData, ScryfallCard } from '../types'
import { fetchArchidektDeck } from '../importers/archidekt'
import { fetchMoxfieldDeck } from '../importers/moxfield-lib'

export function registerBuildSiteCommand(program: Command) {
  program
    .command('build-site')
    .description('Generate a static website for decks')
    .option('-v, --verbose', 'Show list of cards to be fetched')
    .action(async (sources: string[] | object | undefined, options: { verbose?: boolean }) => {
      // Commander might pass options as the first arg if the optional argument is missing in some configs,
      // but usually it passes undefined for missing variadic args.
      // Safe check:
      const distDir = path.join(process.cwd(), 'dist')
      const imagesDir = path.join(distDir, 'images')
      const decksDir = path.join(process.cwd(), 'decks')
      const bundledSiteAssets = getBundledSiteAssets()

      let deckSources: string[] = Array.isArray(sources) ? sources : []

      if (deckSources.length === 0) {
        console.log('No decks specified, building all imported decks...')
        try {
          const files = await fs.readdir(decksDir)
          deckSources = files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
          console.log(`Found ${deckSources.length} decks: ${deckSources.join(', ')}`)
        } catch (e) {
          console.error('Failed to read decks directory:', e)
          return
        }
      }

      console.log('Building static site...')

      await fs.rm(distDir, { recursive: true, force: true })
      await fs.mkdir(imagesDir, { recursive: true })
      const symbolsDir = path.join(imagesDir, 'symbols')
      await fs.mkdir(symbolsDir, { recursive: true })
      await Bun.write(path.join(distDir, 'app.svg'), bundledSiteAssets.appSvg)

      // Fetch and download symbols
      console.log('Fetching and downloading mana symbols...')
      const { fetchSymbology, downloadSymbol } = await import('../scryfall')
      let symbols = await fetchSymbology()
      const symbolMap: Record<string, string> = {} // { "{W}": "images/symbols/W.svg" }
      const missingSymbols = new Set<string>()

      const updateSymbolMap = async () => {
        await Promise.all(
          symbols.map(async (s) => {
            if (symbolMap[s.symbol]) return
            try {
              const filename = await downloadSymbol(s, symbolsDir)
              symbolMap[s.symbol] = `images/symbols/${filename}`
            } catch (e) {
              console.error(`Failed to download symbol ${s.symbol}:`, e)
            }
          }),
        )
      }

      await updateSymbolMap()

      const ensureSymbols = async (text: string | undefined | null) => {
        if (!text) return
        const matches = text.match(/\{[^{}]+\}/g)
        if (!matches) return

        let needsRefresh = false
        for (const m of matches) {
          if (!symbolMap[m] && !missingSymbols.has(m)) {
            needsRefresh = true
            break
          }
        }

        if (needsRefresh) {
          console.log('Found new symbols in text. Refreshing symbology...')
          symbols = await fetchSymbology(true)
          await updateSymbolMap()

          // Mark still-missing symbols as missing so we don't retry loop
          for (const m of matches) {
            if (!symbolMap[m]) {
              missingSymbols.add(m)
            }
          }
        }
      }

      const loadedDecks: { data: DeckData }[] = []
      const globalCardMap: Record<string, ScryfallCard | null> = {}
      const allCardNames = new Set<string>()

      // Phase 1: Load Decks
      console.log('Loading decks...')
      for (const source of deckSources) {
        let deckData: DeckData | undefined
        try {
          if (source.startsWith('http')) {
            if (source.includes('archidekt')) {
              const match = source.match(/archidekt\.com\/decks\/(\d+)/)
              if (match && match[1]) deckData = await fetchArchidektDeck(match[1])
            } else if (source.includes('moxfield')) {
              const match = source.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/)
              if (match && match[1]) deckData = await fetchMoxfieldDeck(match[1])
            }
          } else {
            const fileName = path.basename(source.endsWith('.md') ? source : `${source}.md`)
            deckData = await importFromTextFile(path.join(decksDir, fileName))
          }
        } catch (e) {
          console.error(`Failed to load deck '${source}':`, e)
          continue
        }

        if (deckData) {
          loadedDecks.push({ data: deckData })
          console.log(`  - Loaded ${deckData.name}`)
          // Collect Names
          deckData.sections.forEach((s) => s.cards.forEach((c) => allCardNames.add(c.name)))
        }
      }

      // Phase 2: Fetch Cards with Progress Bar
      const uniqueCards = Array.from(allCardNames)
      const totalCards = uniqueCards.length
      console.log(`\nFound ${totalCards} unique cards.`)

      // Pre-check for missing cards
      const missingCards: string[] = []
      const { cardCache } = await import('../cache') // Dynamic import to avoid earlier execution if needed

      for (const name of uniqueCards) {
        const cached = await cardCache.get(name)
        if (!cached) {
          missingCards.push(name)
        }
      }

      if (options.verbose) {
        if (missingCards.length > 0) {
          console.log(`Fetch List (${missingCards.length}):`)
          missingCards.forEach((c) => console.log(` - ${c}`))
        } else {
          console.log('All cards are cached.')
        }
      }

      console.log('Fetching data...')

      const updateProgress = (current: number, total: number) => {
        const width = 30
        const percentage = total === 0 ? 100 : Math.round((current / total) * 100)
        const filled = total === 0 ? width : Math.round((width * current) / total)
        const empty = width - filled
        const bar = '█'.repeat(filled) + '░'.repeat(empty)
        process.stdout.write(`\r[${bar}] ${percentage}% (${current}/${total})`)
      }

      let processed = 0
      updateProgress(0, totalCards)

      for (const name of uniqueCards) {
        if (!globalCardMap[name]) {
          const card = await fetchCardData(name, { silent: true })
          globalCardMap[name] = card
          if (card) {
            await ensureSymbols(card.mana_cost)
            await ensureSymbols(card.oracle_text)

            if (card.image_uris?.normal) {
              const imgName = `${card.id}.jpg`
              await downloadImage(card.image_uris.normal, path.join(imagesDir, imgName))
            } else if (card.card_faces && card.card_faces[0]) {
              if (card.card_faces[0].image_uris?.normal) {
                await downloadImage(
                  card.card_faces[0].image_uris.normal,
                  path.join(imagesDir, `${card.id}.jpg`),
                )
              }
              if (card.card_faces[1] && card.card_faces[1].image_uris?.normal) {
                await downloadImage(
                  card.card_faces[1].image_uris.normal,
                  path.join(imagesDir, `${card.id}_back.jpg`),
                )
              }
            }
          }
        }
        processed++
        updateProgress(processed, totalCards)
      }
      process.stdout.write('\n\n')

      // Phase 3: Generate Site
      console.log('Generating pages...')
      const finalDecks: { data: DeckData; featuredCard: ScryfallCard | null }[] = []

      for (const { data: deckData } of loadedDecks) {
        // Find Featured Card
        let featured: ScryfallCard | null = null
        const commanderSection = deckData.sections.find(
          (s) => s.name.toLowerCase() === 'commander' || s.name.toLowerCase() === 'commanders',
        )

        const deckCards: ScryfallCard[] = []
        deckData.sections.forEach((s) =>
          s.cards.forEach((c) => {
            const card = globalCardMap[c.name]
            if (card) deckCards.push(card)
          }),
        )

        if (commanderSection && commanderSection.cards[0]) {
          const cmdrName = commanderSection.cards[0].name
          featured = globalCardMap[cmdrName] || null
        }

        if (!featured && deckCards.length > 0) {
          let maxPrice = -1
          for (const card of deckCards) {
            const price = parseFloat(card.prices.usd || '0')
            if (price > maxPrice) {
              maxPrice = price
              featured = card
            }
          }
        }

        finalDecks.push({ data: deckData, featuredCard: featured })

        const safeName = deckData.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')

        // Generate Deck List Text (Commander + Main)
        const textLines: string[] = []
        const cmdrSection = deckData.sections.find((s) =>
          s.name.toLowerCase().includes('commander'),
        )
        const mainSection = deckData.sections.find(
          (s) => s.name.toLowerCase() === 'main' || s.name.toLowerCase() === 'mainboard',
        )

        if (cmdrSection) {
          textLines.push(`## ${cmdrSection.name}`)
          cmdrSection.cards.forEach((c) => textLines.push(`${c.quantity} ${c.name}`))
          textLines.push('')
        }

        if (mainSection) {
          textLines.push(`## ${mainSection.name}`)
          mainSection.cards.forEach((c) => textLines.push(`${c.quantity} ${c.name}`))
        } else {
          // Include all other sections (except Sideboard/Maybeboard/Token)
          deckData.sections.forEach((s) => {
            const name = s.name.toLowerCase()
            if (name.includes('commander')) return // Already handled
            if (name.includes('maybeboard')) return
            if (name.includes('sideboard')) return
            if (name.includes('token')) return

            textLines.push('')
            textLines.push(`## ${s.name}`)
            s.cards.forEach((c) => textLines.push(`${c.quantity} ${c.name}`))
          })
        }

        const deckText = textLines.join('\n').trim()
        const deckTextPath = path.join(distDir, 'decks', `${safeName}.txt`)
        await fs.mkdir(path.dirname(deckTextPath), { recursive: true })
        await Bun.write(deckTextPath, deckText)

        const html = render(
          <DeckPage
            deck={deckData}
            cards={globalCardMap}
            symbolMap={symbolMap}
            exportPath={`decks/${safeName}.txt`}
          />,
        )
        await Bun.write(path.join(distDir, `${safeName}.html`), '<!DOCTYPE html>' + html)
      }

      const indexHtml = render(<IndexPage decks={finalDecks} />)
      await Bun.write(path.join(distDir, 'index.html'), '<!DOCTYPE html>' + indexHtml)

      // CSS Pipeline (Pure Tailwind)
      console.log('Compiling CSS...')
      const tempStylesInputPath = path.join(distDir, '.ritual-site-styles.css')
      await Bun.write(tempStylesInputPath, bundledSiteAssets.stylesSourceCss)
      try {
        const proc = Bun.spawn(
          [
            'bunx',
            '@tailwindcss/cli',
            '-i',
            tempStylesInputPath,
            '-o',
            path.join(distDir, 'styles.css'),
            '--minify',
          ],
          {
            stdout: 'inherit',
            stderr: 'inherit',
          },
        )
        await proc.exited
      } catch (e) {
        console.error('Failed to compile CSS:', e)
      } finally {
        await fs.rm(tempStylesInputPath, { force: true })
      }

      console.log('Writing client-side scripts...')
      try {
        for (const [scriptFileName, scriptContents] of Object.entries(bundledSiteAssets.scripts)) {
          await Bun.write(path.join(distDir, scriptFileName), scriptContents)
        }
      } catch (e) {
        console.error('Failed to write scripts:', e)
      }

      console.log(`Site generated in ${distDir}`)
    })
}
