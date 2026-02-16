import { Command } from 'commander'
import path from 'path'
import { createInterface } from 'readline'
import { fetchArchidektDeck } from '../importers/archidekt'
import { fetchMtgGoldfishDeck } from '../importers/mtggoldfish'
import { fetchMoxfieldDeck } from '../importers/moxfield-lib'
import { importFromTextFile } from '../importers/text-file'
import { type DeckData } from '../types'
import { ExitCode } from './scripting'
import { getLogger } from '../logger'

interface SaveDeckOptions {
  forceOverwrite?: boolean
  nonInteractive?: boolean
  assumeYes?: boolean
  dryRun?: boolean
}

export function resolveMoxfieldUserAgent(
  cliOptionValue?: string,
  envValue: string | undefined = process.env.MOXFIELD_USER_AGENT,
): string | undefined {
  const trimmedCliOption = cliOptionValue?.trim()
  if (trimmedCliOption) {
    return trimmedCliOption
  }

  const trimmedEnvValue = envValue?.trim()
  if (trimmedEnvValue) {
    return trimmedEnvValue
  }

  return undefined
}

async function withMoxfieldUserAgent<T>(userAgent: string, run: () => Promise<T>): Promise<T> {
  const previousUserAgent = process.env.MOXFIELD_USER_AGENT
  process.env.MOXFIELD_USER_AGENT = userAgent

  try {
    return await run()
  } finally {
    if (previousUserAgent === undefined) {
      delete process.env.MOXFIELD_USER_AGENT
    } else {
      process.env.MOXFIELD_USER_AGENT = previousUserAgent
    }
  }
}

function normalizeSaveDeckOptions(options?: SaveDeckOptions | boolean): Required<SaveDeckOptions> {
  if (typeof options === 'boolean') {
    return {
      forceOverwrite: options,
      nonInteractive: false,
      assumeYes: false,
      dryRun: false,
    }
  }

  return {
    forceOverwrite: options?.forceOverwrite ?? false,
    nonInteractive: options?.nonInteractive ?? false,
    assumeYes: options?.assumeYes ?? false,
    dryRun: options?.dryRun ?? false,
  }
}

// Export saveDeck for reuse
export async function saveDeck(
  deckData: DeckData,
  decksDir: string,
  options?: SaveDeckOptions | boolean,
): Promise<void> {
  const resolvedOptions = normalizeSaveDeckOptions(options)
  // Determine Target Filename
  const safeName = deckData.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  let fileName = `${safeName}.md`

  // Scan Existing Decks for ID Conflict
  let conflictFile: string | null = null
  let conflictReason: 'id' | 'name' | null = null

  let existingFiles: string[] = []
  try {
    const fs = await import('fs/promises')
    existingFiles = await fs.readdir(decksDir)
  } catch (e) {
    existingFiles = []
  }

  // Helper to read simple frontmatter without heavy parser
  const readFrontmatter = async (fPath: string): Promise<{ sourceId?: string }> => {
    const content = await Bun.file(fPath).text()
    const match = content.match(/^sourceId:\s*"?([^\s"]+)"?/m)
    return match ? { sourceId: match[1] } : {}
  }

  if (deckData.sourceId) {
    for (const f of existingFiles) {
      if (f.endsWith('.md')) {
        const fPath = path.join(decksDir, f)
        const meta = await readFrontmatter(fPath)
        if (meta.sourceId === deckData.sourceId) {
          conflictFile = f
          conflictReason = 'id'
          break
        }
      }
    }
  }

  // If no ID conflict, check Filename conflict
  if (!conflictFile && existingFiles.includes(fileName)) {
    conflictFile = fileName
    conflictReason = 'name'
  }

  let filePath = path.join(decksDir, fileName)
  const shouldOverwrite = resolvedOptions.forceOverwrite || resolvedOptions.assumeYes

  if (conflictFile && shouldOverwrite) {
    filePath = path.join(decksDir, conflictFile)
    if (!resolvedOptions.dryRun) {
      getLogger().info(`Overwriting ${conflictFile}...`)
    }
  } else if (conflictFile && !shouldOverwrite) {
    if (resolvedOptions.nonInteractive) {
      throw new Error(
        `Import conflict for '${conflictFile}'. Re-run with --overwrite or --yes, or disable --non-interactive.`,
      )
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    const question = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve))

    if (conflictReason === 'id') {
      getLogger().info(`\nDeck already exists (ID Match): ${conflictFile}`)
    } else {
      getLogger().info(`\nFile already exists (Name Conflict): ${conflictFile}`)
    }

    let response = ''
    while (!['o', 'r', 'c'].includes(response)) {
      response = (await question('Action: [O]verwrite, [R]ename, [C]ancel? ')).toLowerCase()
    }

    rl.close()

    if (response === 'c') {
      getLogger().info('Import cancelled.')
      return
    } else if (response === 'r') {
      const rl2 = createInterface({ input: process.stdin, output: process.stdout })
      const q2 = (q: string) => new Promise<string>((resolve) => rl2.question(q, resolve))

      let newName = ''
      while (!newName) {
        newName = await q2('Enter new filename (without .md): ')
      }
      rl2.close()

      fileName = newName.endsWith('.md') ? newName : `${newName}.md`
      filePath = path.join(decksDir, fileName)

      // Double check new filename
      if (await Bun.file(filePath).exists()) {
        getLogger().error(`File '${fileName}' also exists. Aborting.`)
        throw new Error('File exists')
      }
    } else if (response === 'o') {
      // Overwrite existing file.
      filePath = path.join(decksDir, conflictFile)
      getLogger().info(`Overwriting ${conflictFile}...`)
    }
  }

  const sourceIdLine = deckData.sourceId ? `sourceId: "${deckData.sourceId}"\n` : ''
  const sourceUrlLine = deckData.sourceUrl ? `sourceUrl: "${deckData.sourceUrl}"\n` : ''
  const descriptionLine = deckData.description
    ? `description: "${deckData.description.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"\n`
    : ''

  const fileHeader = `---
name: "${deckData.name}"
source: "${deckData.sourceUrl || ''}"
${sourceIdLine}${sourceUrlLine}${descriptionLine}created: "${new Date().toISOString()}"
tags: []
---

# ${deckData.name}

`

  let cardList = ''
  for (const section of deckData.sections) {
    if (section.cards.length > 0) {
      cardList += `## ${section.name}\n`
      cardList += section.cards.map((c) => `${c.quantity} ${c.name}`).join('\n')
      cardList += '\n\n'
    }
  }

  const fileContent = fileHeader + cardList

  if (resolvedOptions.dryRun) {
    getLogger().info(`[dry-run] Would save deck to: ${filePath}`)
    return
  }

  await Bun.write(filePath, fileContent)
  getLogger().info(`Successfully imported deck to: ${filePath}`)
}

export function registerImportCommand(program: Command) {
  program
    .command('import')
    .description('Import a deck from a URL (Archidekt, Moxfield, MTGGoldfish) or local text file')
    .argument('<source>', 'URL or file path')
    .option('-o, --overwrite', 'Overwrite existing decks without prompting')
    .option('--non-interactive', 'Disable interactive prompts; fail when input is required')
    .option('-y, --yes', 'Automatically answer yes to prompts (implies overwrite on conflicts)')
    .option('--dry-run', 'Preview actions without writing deck files')
    .option(
      '--moxfield-user-agent <agent>',
      'Moxfield-approved unique User-Agent string (required for Moxfield imports unless MOXFIELD_USER_AGENT is set)',
    )
    .action(
      async (
        source: string,
        options: {
          overwrite?: boolean
          nonInteractive?: boolean
          yes?: boolean
          dryRun?: boolean
          moxfieldUserAgent?: string
        },
      ) => {
        try {
          let deckData: DeckData | undefined

          if (source.startsWith('https://')) {
            // Check for Archidekt
            const archidektMatch = source.match(/archidekt\.com\/decks\/(\d+)/)

            if (archidektMatch?.[1]) {
              const deckId = archidektMatch[1]
              getLogger().info(`Fetching deck ID ${deckId} from Archidekt...`)
              deckData = await fetchArchidektDeck(deckId)
            } else {
              // Check for Moxfield
              const moxfieldMatch = source.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/)
              if (moxfieldMatch?.[1]) {
                const deckId = moxfieldMatch[1]
                const moxfieldUserAgent = resolveMoxfieldUserAgent(options.moxfieldUserAgent)
                if (!moxfieldUserAgent) {
                  getLogger().error(
                    'Error: Moxfield imports require a unique Moxfield-approved user agent string. Set MOXFIELD_USER_AGENT or pass --moxfield-user-agent <agent>. Contact Moxfield support if you need one.',
                  )
                  process.exitCode = ExitCode.UsageError
                  return
                }
                getLogger().info(`Fetching deck ID ${deckId} from Moxfield...`)
                deckData = await withMoxfieldUserAgent(moxfieldUserAgent, async () =>
                  fetchMoxfieldDeck(deckId),
                )
              } else if (source.includes('mtggoldfish.com')) {
                getLogger().info('Fetching deck from MTGGoldfish...')
                deckData = await fetchMtgGoldfishDeck(source)
              } else {
                getLogger().error(
                  'Error: URL not supported. Use Archidekt, Moxfield or MTGGoldfish URLs.',
                )
                process.exitCode = ExitCode.UsageError
                return
              }
            }
          } else {
            // Assume file path
            getLogger().info(`Reading deck from file: ${source}...`)
            deckData = await importFromTextFile(source)
          }

          if (!deckData) {
            throw new Error('Failed to parse deck data')
          }

          const decksDir = path.join(process.cwd(), 'decks')
          await saveDeck(deckData, decksDir, {
            forceOverwrite: options.overwrite === true,
            nonInteractive: options.nonInteractive === true || options.yes === true,
            assumeYes: options.yes === true,
            dryRun: options.dryRun === true,
          })
        } catch (error) {
          getLogger().error('Failed to import deck:', error)
          process.exitCode = ExitCode.RuntimeError
        }
      },
    )
}
