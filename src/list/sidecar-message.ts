/**
 * The words a list sidecar's reader uses when the file cannot be read — the
 * custom-art `.art.json` and the `.categories.json` alike — as messages
 * (English plus their catalog key), so the admin API answers in English and the
 * CLI and admin render them in their reader's language.
 *
 * Browser-safe, because the categories record that uses it is bundled into both
 * SPAs. Its invalid-JSON key lives in `domain-list`, which both SPAs register; the
 * path-prefixed {@link sidecarProblem} is only built by the node-side loaders,
 * and its key lives in `domain-list-files`.
 */

import { syncMessage, type SyncMessage, type SyncText } from '../sync/message'
import { getErrorMessage } from '../util/errors'

/** A sidecar whose bytes are not JSON; the parser's own message rides as it came. */
export function invalidJsonMessage(error: unknown): SyncMessage {
  return syncMessage('domain.list.sidecar.invalidJson', { error: getErrorMessage(error) })
}

/** A sidecar problem, prefixed with the sidecar's path. */
export function sidecarProblem(sidecarPath: string, reason: SyncText): SyncMessage {
  return syncMessage('domain.list.sidecar.problem', { file: sidecarPath, reason })
}
