import { Command } from 'commander'
import {
  ArchidektClient,
  createPacedArchidektClient,
  type ArchidektDeckSimple,
  getArchidektFormat,
} from '../clients/ArchidektClient'
import { getLogger } from '../util/logger'
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
import { CardCommandError, getErrorMessage } from '../util/errors'
import { promptForLoginOutcome } from '../auth/login-helper'
import { getDecksDir } from '../config/ritual-config'
import { ask, resolveImportPrintings } from './prompts-helpers'
import { stripDeckPrintings } from '../importers/url-dispatch'
import {
  addSyncPrintingsOptions,
  readSyncPrintingsFlag,
  type SyncPrintingsOptions,
} from './sync-printings-flag'
import { promptsUnavailable, promptsUnavailableReason } from '../util/no-input'
import { t } from '../i18n/t'

type ImportAccountOptions = {
  all?: boolean
  overwrite?: boolean
  yes?: boolean
  dryRun?: boolean
  output: OutputFormat
  quiet: boolean
} & SyncPrintingsOptions

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
  if (username === undefined) return t('cli.importAccount.noDecksSelf')
  return t('cli.importAccount.noDecksPublic', { username })
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
      addSyncPrintingsOptions(
        program
          .command('import-account')
          .description(t('help.importAccount.description'))
          .argument('[username]', t('help.importAccount.username'))
          .option('-a, --all', t('help.importAccount.all'))
          .option('-o, --overwrite', t('help.importAccount.overwrite'))
          .option('-y, --yes', t('help.importAccount.yes')),
      ),
      t('help.importAccount.dryRun'),
    ),
  ).action(
    async (username: string | undefined, options: ImportAccountOptions, command: Command) => {
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
            t('cli.importAccount.selectionNeedsPrompt', { reason: promptsUnavailableReason() }),
            scripting,
            undefined,
            'cli.importAccount.selectionNeedsPrompt',
          )
          process.exitCode = ExitCode.UsageError
          return
        }

        // The printing question is a prompt too, asked once for the whole run
        // — and its answer never depends on what the fetch returns (Archidekt
        // decks always state their editions), so it is asked, defaulted, or
        // refused before any network work, like the --all gate above.
        const keepPrintings = await resolveImportPrintings({
          flag: readSyncPrintingsFlag(command, options),
          deckStatesPrintings: true,
          scripting,
        })
        if (keepPrintings === undefined) {
          emitError(
            'usage_error',
            t('cli.import.cancelled'),
            scripting,
            undefined,
            'cli.import.cancelled',
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
              info(t('cli.importAccount.sessionExpiredNoPrompt'))
              return undefined
            }
            info(t('cli.importAccount.sessionExpiredRelogin'))
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
            emitError(
              'usage_error',
              t('cli.importAccount.needUsernameOrLogin'),
              scripting,
              undefined,
              'cli.importAccount.needUsernameOrLogin',
            )
            process.exitCode = ExitCode.UsageError
            return
          }
          info(t('cli.importAccount.fetchingOwn', { username: currentUser.username }))

          if (!token) {
            token = await ensureToken()
          }

          if (!token) {
            emitError(
              'runtime_error',
              t('cli.importAccount.noToken'),
              scripting,
              undefined,
              'cli.importAccount.noToken',
            )
            process.exitCode = ExitCode.RuntimeError
            return
          }
          decks = await client.fetchOwnDecks(token)
        } else {
          // Username provided
          if (currentUser && currentUser.username.toLowerCase() === username.toLowerCase()) {
            info(t('cli.importAccount.fetchingAuthenticated', { username }))
            if (token) {
              decks = await client.fetchOwnDecks(token)
            } else {
              info(t('cli.importAccount.sessionExpiredFallback'))
              decks = await client.fetchPublicDecks(username)
            }
          } else {
            info(t('cli.importAccount.fetchingPublic', { username }))
            decks = await client.fetchPublicDecks(username)
            // We don't necessarily need a token for public decks of others, but we keep it if we have it.
          }
        }

        info(t('cli.importAccount.foundDecks', { count: decks.length }))

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
            message: t('cli.importAccount.selectPrompt'),
            choices: decks.map((d) => ({
              title: d.name,
              value: d,
              selected: true,
              description: t('cli.importAccount.deckFormatHint', {
                format: getArchidektFormat(d.deckFormat),
              }),
            })),
            hint: t('cli.importAccount.multiselectHint'),
          })

          if (selection === undefined) {
            // Matches `import` / `import-changes`: a cancelled prompt is a usage
            // error, so a script can tell it from a successful no-op.
            emitError(
              'usage_error',
              t('cli.import.cancelled'),
              scripting,
              undefined,
              'cli.import.cancelled',
            )
            process.exitCode = ExitCode.UsageError
            return
          }
          selectedDecks = selection
        }

        if (selectedDecks.length === 0) {
          info(t('cli.importAccount.noneSelected'))
          emitResult(account, decks.length, [])
          return
        }

        info(t('cli.importAccount.importingDecks', { count: selectedDecks.length }))

        const results: DeckImportResult[] = []
        for (const deck of selectedDecks) {
          info(t('cli.importAccount.processingDeck', { name: deck.name, id: deck.id }))
          try {
            const fetched = await client.fetchDeck(deck.id.toString(), token)
            const deckData = keepPrintings ? fetched : stripDeckPrintings(fetched)
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
                error: t('cli.importAccount.skippedAtPrompt'),
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
            info(
              `  - ${t('cli.importAccount.deckDone', {
                state: dryRun ? 'planned' : 'saved',
                name: deck.name,
              })}`,
            )
          } catch (e: unknown) {
            const msg = getErrorMessage(e)
            results.push({ id: deck.id, name: deck.name, status: 'failed', error: msg })
            logger.error(
              `  - ${t('cli.importAccount.deckFailed', { name: deck.name, reason: msg })}`,
            )
            // A per-deck conflict that needs --overwrite/--yes is a usage error;
            // keep its code rather than reporting it as a runtime failure.
            process.exitCode = e instanceof CardCommandError ? e.exitCode : ExitCode.RuntimeError
          }
        }

        info(dryRun ? t('cli.importAccount.dryRunComplete') : t('cli.importAccount.done'))
        emitResult(account, decks.length, results)
      } catch (e: unknown) {
        // The prompt guards throw a structured usage error when input is
        // needed but prompts are unavailable; keep its exit code.
        if (e instanceof CardCommandError) {
          emitError(e.code, e.message, scripting, e.details, e.messageRef)
          process.exitCode = e.exitCode
          return
        }
        emitError('runtime_error', getErrorMessage(e), scripting)
        process.exitCode = ExitCode.RuntimeError
      }
    },
  )
}
