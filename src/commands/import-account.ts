import { Command } from 'commander'
import prompts from 'prompts'
import path from 'path'
import {
  ArchidektClient,
  type ArchidektDeckSimple,
  getArchidektFormat,
} from '../clients/ArchidektClient'
import { FileTokenStore } from '../auth/FileTokenStore'
import { ArchidektAuth } from '../auth/ArchidektAuth'
import { saveDeck } from './import'
import { ExitCode } from './scripting'

export function registerImportAccountCommand(program: Command) {
  program
    .command('import-account')
    .description('Import decks from an Archidekt user')
    .argument('[username]', 'Archidekt username (optional if logged in)')
    .option('-a, --all', 'Import all decks without interactive selection')
    .option('-o, --overwrite', 'Overwrite existing decks without prompting')
    .option('--non-interactive', 'Disable interactive prompts; requires --all or --yes')
    .option('-y, --yes', 'Automatically answer yes to prompts')
    .option('--dry-run', 'Preview imports without writing deck files')
    .action(
      async (
        username: string | undefined,
        options: {
          all?: boolean
          overwrite?: boolean
          nonInteractive?: boolean
          yes?: boolean
          dryRun?: boolean
        },
      ) => {
        try {
          const nonInteractiveMode = options.nonInteractive === true || options.yes === true
          const tokenStore = new FileTokenStore()
          const auth = new ArchidektAuth(tokenStore)
          const client = new ArchidektClient()

          const currentUser = await auth.getStoredUser()
          let decks: ArchidektDeckSimple[] = []
          let token: string | undefined

          // Determine if we are authenticated and if we need the token
          const storedToken = await auth.getToken()
          if (storedToken) {
            token = storedToken
          } else {
            token = undefined
          }

          // Helper to handle login if needed
          const ensureToken = async () => {
            token = (await auth.getToken()) ?? undefined
            if (!token) {
              if (nonInteractiveMode) {
                console.log(
                  'Session expired or invalid. Use `ritual login archidekt` before retrying.',
                )
                return undefined
              }
              console.log('Session expired or invalid. Please login again.')
              const { promptForLogin } = await import('../auth/login-helper')
              const success = await promptForLogin(auth)
              if (success) {
                token = (await auth.getToken()) ?? undefined
              }
            }
            return token
          }

          if (!username) {
            if (!currentUser) {
              console.error('Error: You must specify a username or login first.')
              process.exitCode = ExitCode.UsageError
              return
            }
            console.log(`Fetching decks for logged in user: ${currentUser.username}...`)

            if (!token) {
              token = await ensureToken()
            }

            if (!token) {
              console.error('Error: Could not retrieve valid token.')
              process.exitCode = ExitCode.RuntimeError
              return
            }
            decks = await client.fetchOwnDecks(token)
          } else {
            // Username provided
            if (currentUser && currentUser.username.toLowerCase() === username.toLowerCase()) {
              console.log(`Fetching authenticated decks for: ${username}...`)
              if (token) {
                decks = await client.fetchOwnDecks(token)
              } else {
                console.log('Session expired, falling back to public fetch.')
                decks = await client.fetchPublicDecks(username)
              }
            } else {
              console.log(`Fetching public decks for: ${username}...`)
              decks = await client.fetchPublicDecks(username)
              // We don't necessarily need a token for public decks of others, but we keep it if we have it.
            }
          }

          console.log(`Found ${decks.length} decks.`)

          if (decks.length === 0) {
            console.log('No decks found.')
            return
          }

          let selectedDecks: ArchidektDeckSimple[] = []

          if (options.all || options.yes) {
            selectedDecks = decks
          } else {
            if (nonInteractiveMode) {
              console.error('Error: --non-interactive requires --all or --yes for deck selection.')
              process.exitCode = ExitCode.UsageError
              return
            }
            const response = await prompts({
              type: 'multiselect',
              name: 'value',
              message: 'Select decks to import',
              choices: decks.map((d) => ({
                title: d.name,
                value: d,
                selected: true,
                description: `Format: ${getArchidektFormat(d.deckFormat)}`,
              })),
              hint: '- Space to toggle. Return to submit',
            })

            if (!response.value) {
              console.log('Cancelled')
              return
            }
            selectedDecks = response.value
          }

          if (selectedDecks.length === 0) {
            console.log('No decks selected.')
            return
          }

          console.log(`Importing ${selectedDecks.length} decks...`)

          for (const deck of selectedDecks) {
            console.log(`Processing: ${deck.name} (${deck.id})...`)
            try {
              const deckData = await client.fetchDeck(deck.id.toString(), token)
              const decksDir = path.join(process.cwd(), 'decks')
              await saveDeck(deckData, decksDir, {
                forceOverwrite: options.overwrite === true,
                nonInteractive: nonInteractiveMode,
                assumeYes: options.yes === true,
                dryRun: options.dryRun === true,
              })
              const statusLabel = options.dryRun ? 'Planned' : 'Saved'
              console.log(`  - ${statusLabel} ${deck.name}`)
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e)
              console.error(`  - Failed to import ${deck.name}:`, msg)
              process.exitCode = ExitCode.RuntimeError
            }
          }

          if (options.dryRun) {
            console.log('Dry run complete.')
          } else {
            console.log('Done!')
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error('Error:', msg)
          process.exitCode = ExitCode.RuntimeError
        }
      },
    )
}
