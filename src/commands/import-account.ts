import { Command } from 'commander'
import {
  createPacedArchidektClient,
  type ArchidektDeckSimple,
  getArchidektFormat,
} from '../clients/ArchidektClient'
import { getLogger } from '../logger'
import { FileTokenStore } from '../auth/FileTokenStore'
import { ArchidektAuth } from '../auth/ArchidektAuth'
import { saveDeck } from './import'
import { addDryRunOption, ExitCode } from './scripting'
import { CardCommandError, getErrorMessage } from '../errors'
import { promptForLoginOutcome } from '../auth/login-helper'
import { getDecksDir } from '../ritual-config'
import { ask } from './prompts-helpers'
import { promptsUnavailable, promptsUnavailableReason } from '../no-input'

type ImportAccountOptions = {
  all?: boolean
  overwrite?: boolean
  yes?: boolean
  dryRun?: boolean
}

export function registerImportAccountCommand(program: Command): void {
  addDryRunOption(
    program
      .command('import-account')
      .description('Import decks from an Archidekt user')
      .argument('[username]', 'Archidekt username (optional if logged in)')
      .option('-a, --all', 'Import all decks without interactive selection')
      .option('-o, --overwrite', 'Overwrite existing decks without prompting')
      .option(
        '-y, --yes',
        'Automatically answer yes to the overwrite confirmation on import conflicts',
      ),
    'Preview imports without writing deck files',
  ).action(async (username: string | undefined, options: ImportAccountOptions) => {
    try {
      // Deck selection is a prompt; with prompts disabled the run must say
      // which decks it wants up front. Fail before any network work.
      if (options.all !== true && promptsUnavailable()) {
        console.error(
          `Error: deck selection requires a prompt. Pass --all to import every deck (${promptsUnavailableReason()}).`,
        )
        process.exitCode = ExitCode.UsageError
        return
      }
      const tokenStore = new FileTokenStore()
      const auth = new ArchidektAuth(tokenStore)
      // One paced client for the whole import, so a long deck list is fetched
      // politely and a 429 backoff explains itself instead of looking hung.
      const client = createPacedArchidektClient((message) => getLogger().warn(message))

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
          if (promptsUnavailable()) {
            console.log('Session expired or invalid. Use `ritual login archidekt` before retrying.')
            return undefined
          }
          console.log('Session expired or invalid. Please login again.')
          const outcome = await promptForLoginOutcome(auth)
          if (outcome === 'success') {
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

      if (options.all === true) {
        selectedDecks = decks
      } else {
        // Reachable only with prompts available — the --all pre-check above
        // already refused every non-interactive run with a friendlier message.
        const selection = await ask<ArchidektDeckSimple[]>({
          type: 'multiselect',
          message: 'Select decks to import',
          choices: decks.map((d) => ({
            title: d.name,
            value: d,
            selected: true,
            description: `Format: ${getArchidektFormat(d.deckFormat)}`,
          })),
          hint: '- Space to toggle. Return to submit',
        })

        if (selection === undefined) {
          console.log('Cancelled')
          return
        }
        selectedDecks = selection
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
          const decksDir = getDecksDir()
          await saveDeck(deckData, decksDir, {
            forceOverwrite: options.overwrite === true,
            assumeYes: options.yes === true,
            dryRun: options.dryRun === true,
          })
          const statusLabel = options.dryRun ? 'Planned' : 'Saved'
          console.log(`  - ${statusLabel} ${deck.name}`)
        } catch (e: unknown) {
          const msg = getErrorMessage(e)
          console.error(`  - Failed to import ${deck.name}:`, msg)
          // A per-deck conflict that needs --overwrite/--yes is a usage error;
          // keep its code rather than reporting it as a runtime failure.
          process.exitCode = e instanceof CardCommandError ? e.exitCode : ExitCode.RuntimeError
        }
      }

      if (options.dryRun) {
        console.log('Dry run complete.')
      } else {
        console.log('Done!')
      }
    } catch (e: unknown) {
      // The prompt guards throw a structured usage error when input is
      // needed but prompts are unavailable; keep its exit code.
      if (e instanceof CardCommandError) {
        console.error('Error:', e.message)
        process.exitCode = e.exitCode
        return
      }
      const msg = getErrorMessage(e)
      console.error('Error:', msg)
      process.exitCode = ExitCode.RuntimeError
    }
  })
}
