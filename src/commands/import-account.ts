import { Command } from 'commander'
import {
  ArchidektClient,
  createPacedArchidektClient,
  type ArchidektDeckSimple,
  getArchidektFormat,
} from '../clients/ArchidektClient'
import { getLogger } from '../logger'
import { FileTokenStore } from '../auth/FileTokenStore'
import { ArchidektAuth } from '../auth/ArchidektAuth'
import { saveDeck, type SaveListAction } from './import'
import {
  addDryRunOption,
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  installScriptingLogger,
  normalizeScriptingOptions,
  type OutputFormat,
} from './scripting'
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
  output: OutputFormat
  quiet: boolean
}

/** What importing one of the account's decks did. */
type DeckImportStatus = 'imported' | 'planned' | 'skipped' | 'failed'

/** One deck's outcome in the structured result. */
type DeckImportResult = {
  id: number
  name: string
  status: DeckImportStatus
  /** How the save resolved the target; absent when the deck was not written. */
  action?: SaveListAction
  filePath?: string
  /** Why the deck failed or was skipped; absent on success. */
  error?: string
}

/** Structured `--output json`/`ndjson` payload for a whole `import-account` run. */
type ImportAccountJsonResult = {
  /** The account imported from: the argument, or the logged-in user. */
  username: string | undefined
  /** Decks the account exposed (following the endpoint's pagination to the end). */
  found: number
  selected: number
  imported: number
  failed: number
  /** Selected decks that were neither imported nor failed (a cancelled conflict prompt). */
  skipped: number
  dryRun: boolean
  decks: DeckImportResult[]
}

/**
 * Archidekt's deck list endpoint answers an unknown `ownerUsername` with an
 * empty result set, exactly like a real account holding no public decks — there
 * is no signal that separates the two, so the message names both possibilities
 * instead of guessing.
 */
function noDecksMessage(username: string | undefined): string {
  if (username === undefined) return 'No decks found for the logged-in account.'
  return (
    `No public decks found for '${username}' — check the spelling; Archidekt does not ` +
    'distinguish an unknown user from an account with no public decks. ' +
    'Private decks require `ritual login archidekt`.'
  )
}

/**
 * Dependencies the command builds for itself in production. A test supplies
 * `createClient` to drive the whole post-validation surface — the no-decks
 * message, the structured payload, the per-deck statuses — without a network.
 */
export type ImportAccountDeps = {
  /** Builds the Archidekt client; `onWait` reports a 429 backoff. */
  createClient?: (onWait: (message: string) => void) => ArchidektClient
}

export function registerImportAccountCommand(program: Command, deps: ImportAccountDeps = {}): void {
  addScriptingOptions(
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
    ),
  ).action(async (username: string | undefined, options: ImportAccountOptions) => {
    const scripting = normalizeScriptingOptions(options)
    installScriptingLogger(scripting)
    const logger = getLogger()
    const dryRun = options.dryRun === true
    /** Progress chatter: silent under `--quiet`, off stdout under json/ndjson. */
    const info = (message: string): void => {
      logger.info(message)
    }

    const emitResult = (
      account: string | undefined,
      found: number,
      results: DeckImportResult[],
    ): void => {
      if (scripting.output === 'text') return
      const payload: ImportAccountJsonResult = {
        username: account,
        found,
        selected: results.length,
        imported: results.filter((r) => r.status === 'imported' || r.status === 'planned').length,
        failed: results.filter((r) => r.status === 'failed').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        dryRun,
        decks: results,
      }
      emitOutput(payload, scripting)
    }

    try {
      // Deck selection is a prompt; with prompts disabled the run must say
      // which decks it wants up front. Fail before any network work.
      if (options.all !== true && promptsUnavailable()) {
        emitError(
          'usage_error',
          `Deck selection requires a prompt. Pass --all to import every deck (${promptsUnavailableReason()}).`,
          scripting,
        )
        process.exitCode = ExitCode.UsageError
        return
      }
      const tokenStore = new FileTokenStore()
      const auth = new ArchidektAuth(tokenStore)
      // One paced client for the whole import, so a long deck list is fetched
      // politely and a 429 backoff explains itself instead of looking hung.
      const createClient = deps.createClient ?? ((onWait) => createPacedArchidektClient(onWait))
      const client = createClient((message) => logger.warn(message))

      const currentUser = await auth.getStoredUser()
      let decks: ArchidektDeckSimple[] = []
      let token: string | undefined = (await auth.getToken()) ?? undefined

      // Helper to handle login if needed
      const ensureToken = async (): Promise<string | undefined> => {
        token = (await auth.getToken()) ?? undefined
        if (!token) {
          if (promptsUnavailable()) {
            info('Session expired or invalid. Use `ritual login archidekt` before retrying.')
            return undefined
          }
          info('Session expired or invalid. Please login again.')
          const outcome = await promptForLoginOutcome(auth)
          if (outcome === 'success') {
            token = (await auth.getToken()) ?? undefined
          }
        }
        return token
      }

      const account = username ?? currentUser?.username

      if (!username) {
        if (!currentUser) {
          emitError('usage_error', 'You must specify a username or login first.', scripting)
          process.exitCode = ExitCode.UsageError
          return
        }
        info(`Fetching decks for logged in user: ${currentUser.username}...`)

        if (!token) {
          token = await ensureToken()
        }

        if (!token) {
          emitError('runtime_error', 'Could not retrieve valid token.', scripting)
          process.exitCode = ExitCode.RuntimeError
          return
        }
        decks = await client.fetchOwnDecks(token)
      } else {
        // Username provided
        if (currentUser && currentUser.username.toLowerCase() === username.toLowerCase()) {
          info(`Fetching authenticated decks for: ${username}...`)
          if (token) {
            decks = await client.fetchOwnDecks(token)
          } else {
            info('Session expired, falling back to public fetch.')
            decks = await client.fetchPublicDecks(username)
          }
        } else {
          info(`Fetching public decks for: ${username}...`)
          decks = await client.fetchPublicDecks(username)
          // We don't necessarily need a token for public decks of others, but we keep it if we have it.
        }
      }

      info(`Found ${decks.length} decks.`)

      if (decks.length === 0) {
        // Importing nothing is rarely the intent, and a typo is the likeliest
        // cause, so this is essential output rather than progress chatter.
        logger.warn(noDecksMessage(username))
        emitResult(account, 0, [])
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
          // Matches `import` / `import-changes`: a cancelled prompt is a usage
          // error, so a script can tell it from a successful no-op.
          emitError('usage_error', 'Cancelled.', scripting)
          process.exitCode = ExitCode.UsageError
          return
        }
        selectedDecks = selection
      }

      if (selectedDecks.length === 0) {
        info('No decks selected.')
        emitResult(account, decks.length, [])
        return
      }

      info(`Importing ${selectedDecks.length} decks...`)

      const results: DeckImportResult[] = []
      for (const deck of selectedDecks) {
        info(`Processing: ${deck.name} (${deck.id})...`)
        try {
          const deckData = await client.fetchDeck(deck.id.toString(), token)
          const outcome = await saveDeck(deckData, getDecksDir(), {
            forceOverwrite: options.overwrite === true,
            assumeYes: options.yes === true,
            dryRun,
            quiet: scripting.quiet,
          })
          if (outcome.status === 'cancelled') {
            results.push({
              id: deck.id,
              name: deck.name,
              status: 'skipped',
              error: 'Import cancelled at the conflict prompt',
            })
            continue
          }
          results.push({
            id: deck.id,
            name: deck.name,
            status: dryRun ? 'planned' : 'imported',
            action: outcome.action,
            filePath: outcome.filePath,
          })
          info(`  - ${dryRun ? 'Planned' : 'Saved'} ${deck.name}`)
        } catch (e: unknown) {
          const msg = getErrorMessage(e)
          results.push({ id: deck.id, name: deck.name, status: 'failed', error: msg })
          logger.error(`  - Failed to import ${deck.name}: ${msg}`)
          // A per-deck conflict that needs --overwrite/--yes is a usage error;
          // keep its code rather than reporting it as a runtime failure.
          process.exitCode = e instanceof CardCommandError ? e.exitCode : ExitCode.RuntimeError
        }
      }

      info(dryRun ? 'Dry run complete.' : 'Done!')
      emitResult(account, decks.length, results)
    } catch (e: unknown) {
      // The prompt guards throw a structured usage error when input is
      // needed but prompts are unavailable; keep its exit code.
      if (e instanceof CardCommandError) {
        emitError(e.code, e.message, scripting, e.details)
        process.exitCode = e.exitCode
        return
      }
      emitError('runtime_error', getErrorMessage(e), scripting)
      process.exitCode = ExitCode.RuntimeError
    }
  })
}
