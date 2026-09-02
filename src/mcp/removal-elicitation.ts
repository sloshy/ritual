/**
 * The `sync_collection` tool's way of asking the user which binder loses a card.
 *
 * A pull that must take only *some* of a printing's copies, when they live in
 * several collection lists, cannot decide which list lost the card. The CLI
 * walks the user through it; the admin page and a plain HTTP caller cannot ask
 * and fail the run instead. Over MCP a client that declares the `elicitation`
 * capability *can* be asked, through the 2026-07-28 multi-round-trip flow: the
 * tool returns an `input_required` result carrying one form per ambiguous
 * removal, the client collects the answers and retries the same call with them
 * in `inputResponses`, and the tool turns those into the explicit per-removal
 * assignments the admin route accepts.
 *
 * No `requestState` rides along. The retried request carries the original
 * arguments, and the answers are only ever turned into assignments the engine
 * validates against the ambiguity it actually finds (`applyRemovalAssignments`
 * refuses a list that holds no copies, or counts that do not add up), so there
 * is no server state to integrity-protect.
 */

import {
  acceptedContent,
  inputRequired,
  inputResponse,
  type InputRequests,
  type InputRequiredResult,
  type McpServer,
} from '@modelcontextprotocol/server'
import { z } from 'zod'
import {
  describeAmbiguousLists,
  describeCollectionKey,
  type AmbiguousRemoval,
} from '../collection-sync/describe'
import type { RemovalAssignment, RemovalChoice } from '../collection-sync/diff'

/**
 * The key an ambiguous removal's form is filed under in `inputRequests`, and
 * read back from in `inputResponses`. The suffix is the removal's own key, which
 * is what the assignment handed to the engine has to name.
 */
const REQUEST_KEY_PREFIX = 'removal:'

/** The answer to one form: copies to give up, keyed by list name. */
const removalAnswerSchema = z.record(z.string(), z.number().int().nonnegative())

/**
 * Whether the client on this request can be asked at all.
 *
 * A 2026-07-28 request carries the client's capabilities in its per-request
 * envelope, which the SDK backfills onto the server's accessor before the
 * handler runs; a 2025-era connection declared them at `initialize`. One read
 * covers both. Returning an `input_required` result to a client that declared
 * no elicitation capability is a protocol error on the modern era and a tool
 * error on the legacy shim — both of which would lose the report — so the tool
 * checks first and falls back to reporting the ambiguity when it cannot ask.
 */
export function clientSupportsElicitation(server: McpServer): boolean {
  return server.server.getClientCapabilities()?.elicitation !== undefined
}

/**
 * The `input_required` result asking, for each ambiguous removal, how many
 * copies each of the lists holding it gives up. One form per removal, with one
 * bounded integer field per list, so a client renders the counts as the reader
 * thinks of them — "one from the binder, none from the long box".
 */
export function elicitRemovalAssignments(
  ambiguous: readonly AmbiguousRemoval[],
): InputRequiredResult {
  const inputRequests: InputRequests = {}
  for (const entry of ambiguous) {
    const card = describeCollectionKey(entry.name, entry.parts)
    inputRequests[`${REQUEST_KEY_PREFIX}${entry.key}`] = inputRequired.elicit({
      message:
        `${entry.quantity} × ${card} left the Archidekt collection, but the local copies ` +
        `live in ${describeAmbiguousLists(entry.lists)}. How many copies should each list give ` +
        `up? The counts must add up to ${entry.quantity}.`,
      requestedSchema: {
        type: 'object',
        properties: Object.fromEntries(
          entry.lists.map((list) => [
            list.list,
            {
              type: 'integer',
              title: list.list,
              description: `Copies to take from "${list.list}", which holds ${list.copies}.`,
              minimum: 0,
              maximum: list.copies,
            },
          ]),
        ),
        required: entry.lists.map((list) => list.list),
      },
    })
  }
  return inputRequired({ inputRequests })
}

/** What a retried request's answers amount to. */
export type ElicitedAssignments =
  /** The request carried no answers: this is the first round. */
  | { kind: 'none' }
  /** The user declined or cancelled at least one form; nothing can be assigned. */
  | { kind: 'declined' }
  /** Every form was answered; the engine validates the counts. */
  | { kind: 'assignments'; assignments: RemovalAssignment[] }

/**
 * Read the answers a retried request carries back into the assignments the
 * admin route takes. An answer that is not a record of non-negative integers
 * counts as declined: the values are untrusted client input, and a form the
 * client could not fill in is one the user did not answer.
 */
export function readRemovalAssignments(
  responses: Record<string, unknown> | undefined,
): ElicitedAssignments {
  const keys = Object.keys(responses ?? {}).filter((key) => key.startsWith(REQUEST_KEY_PREFIX))
  if (keys.length === 0) return { kind: 'none' }

  const assignments: RemovalAssignment[] = []
  for (const key of keys) {
    const view = inputResponse(responses, key)
    if (view.kind !== 'elicit' || view.action !== 'accept') return { kind: 'declined' }
    const answer = acceptedContent(responses, key, removalAnswerSchema)
    if (answer === undefined) return { kind: 'declined' }
    // A list answered with 0 is a list that keeps its copies; the engine reads
    // an absent list the same way, so only the takers are passed on.
    const choices: RemovalChoice[] = Object.entries(answer)
      .filter(([, copies]) => copies > 0)
      .map(([list, copies]) => ({ list, copies }))
    // A form submitted with every field at 0 is a form nobody filled in: the
    // route would refuse an empty choice list as malformed, and "declined" is
    // the honest reading of it.
    if (choices.length === 0) return { kind: 'declined' }
    assignments.push({ key: key.slice(REQUEST_KEY_PREFIX.length), choices })
  }
  return { kind: 'assignments', assignments }
}
