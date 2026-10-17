/**
 * Capturing what a promise rejected with, for assertions on the error itself
 * rather than on `expect().rejects` (whose matcher type bun:test does not
 * expose as awaitable).
 */

import { ArchidektRequestError } from '../../src/auth/archidekt-reply'
import type { SyncMessage } from '../../src/sync/message'
import { CardCommandError } from '../../src/util/errors'

/** How a promise settled. */
type Settled = { rejected: false } | { rejected: true; error: unknown }

/** What `run` rejected with; fails the test when it resolved instead. */
export async function rejectionOf(run: Promise<unknown>): Promise<unknown> {
  const settled: Settled = await run.then(
    (): Settled => ({ rejected: false }),
    (error: unknown): Settled => ({ rejected: true, error }),
  )
  if (!settled.rejected) throw new Error('expected the promise to reject')
  return settled.error
}

/**
 * What `run` rejected with, as a failed Archidekt request: its message (English
 * plus its key) and the status Archidekt answered with. Any other rejection is
 * rethrown.
 */
export async function requestFailureOf(run: Promise<unknown>): Promise<[SyncMessage, number]> {
  const error = await rejectionOf(run)
  if (!(error instanceof ArchidektRequestError)) throw error
  return [error.syncMessage, error.upstreamStatus]
}

/** The structured failure `run` rejected with; any other rejection is rethrown. */
export async function commandFailure(run: Promise<unknown>): Promise<CardCommandError> {
  const error = await rejectionOf(run)
  if (!(error instanceof CardCommandError)) throw error
  return error
}

/** A structured failure's locale-invariant identity: its catalog key and exit code. */
export type FailureIdentity = {
  key: string | undefined
  exitCode: number
}

/** {@link commandFailure}, reduced to what most assertions compare. */
export async function failureIdentity(run: Promise<unknown>): Promise<FailureIdentity> {
  const error = await commandFailure(run)
  return { key: error.messageKey, exitCode: error.exitCode }
}
