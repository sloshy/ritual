import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureLoginsDir, getLoginsDir } from '../logins-dir'
import { writeFileAtomic } from '../../util/atomic-write'
import { hasErrorCode } from '../../util/errno'
import { describeOAuthStoreProblem } from './state-message'
import {
  emptyOAuthState,
  isOAuthStateProblem,
  parseOAuthState,
  pruneOAuthState,
  type OAuthState,
  type OAuthStateProblem,
} from './state'

/** The state file's name inside `.logins/`, beside `admin-auth.json`. */
export const OAUTH_STATE_FILE = 'mcp-oauth.json'

/** Where the workspace's OAuth state lives. */
export function oauthStatePath(): string {
  return path.join(getLoginsDir(), OAUTH_STATE_FILE)
}

/**
 * Why a state file could not be used: its content is invalid (see
 * {@link OAuthStateProblem}), or it could not be read at all (`io`, with the
 * system's error code, such as `EACCES` or `EISDIR`).
 */
export type OAuthFileProblem = OAuthStateProblem | { problem: 'io'; code: string }

/** A state file that could not be opened: which file, and why. */
export type OAuthStoreProblem = OAuthFileProblem & { file: string }

/** Thrown by {@link OAuthStore.update} while the file on disk is unusable. */
export class OAuthStateUnavailableError extends Error {
  constructor(readonly problem: OAuthStoreProblem) {
    super(problem.problem)
  }
}

/** Thrown by {@link OAuthStore.update} when a change would leave a state the parser refuses. */
export class OAuthStateInvariantError extends Error {
  constructor(readonly problem: OAuthStateProblem) {
    super(problem.problem)
  }
}

/** How many times a change is re-applied when the file keeps changing under it. */
const MAX_WRITE_ATTEMPTS = 5

/** Thrown inside {@link OAuthStore.update} when the file changed between its check and its rename. */
class ConcurrentChangeError extends Error {}

/** What identifies one version of the file: a rewrite (a rename) changes at least one of these. */
type FileIdentity = { ino: number; mtimeMs: number; size: number }

function sameIdentity(a: FileIdentity | undefined, b: FileIdentity | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.ino === b.ino && a.mtimeMs === b.mtimeMs && a.size === b.size
}

/** The system error code of a failed file operation, for an `io` problem. */
function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'EIO'
}

/** The file's identity, or `undefined` when it does not exist. */
async function identityOf(file: string): Promise<FileIdentity | undefined> {
  try {
    const stat = await fs.stat(file)
    return { ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return undefined
    throw error
  }
}

/** A read of the file: its state and identity, or why it cannot be used. */
type FileRead =
  | { ok: true; state: OAuthState; identity: FileIdentity | undefined }
  | { ok: false; problem: OAuthFileProblem }

async function readStateFile(file: string): Promise<FileRead> {
  let text: string
  let identity: FileIdentity | undefined
  try {
    identity = await identityOf(file)
    if (identity === undefined) return { ok: true, state: emptyOAuthState(), identity }
    text = await fs.readFile(file, 'utf-8')
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { ok: true, state: emptyOAuthState(), identity: undefined }
    }
    return { ok: false, problem: { problem: 'io', code: errorCode(error) } }
  }
  const parsed = parseOAuthState(text)
  if (isOAuthStateProblem(parsed)) return { ok: false, problem: parsed }
  return { ok: true, state: parsed, identity }
}

/**
 * The OAuth state, held in memory and written through to its file.
 *
 * Every change goes through {@link OAuthStore.update}, and every read that
 * must be current through {@link OAuthStore.read}; both run one at a time in
 * arrival order. Each first checks whether the file changed behind the
 * store's back (edited, or rewritten by another process) and reloads it; a
 * file deleted while the store is open reads as an empty state, though
 * deleting it is meant for a stopped server (a credential change is the way
 * to revoke everything while it runs). A file that no longer parses makes the
 * store fail closed — no token verifies and no change is written — until it
 * is fixed.
 *
 * A change is applied to a copy, pruned, checked against the parser (so the
 * writer can never produce a file the next start refuses), and written
 * atomically (`0600`, like `admin-auth.json`) only when it differs from what
 * is stored; only then does it become current.
 */
export class OAuthStore {
  private current: OAuthState
  /** The file version last read or written; `unknown` forces the next check to reload. */
  private identity: FileIdentity | undefined | 'unknown'
  private broken: OAuthStoreProblem | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private inUse: () => ReadonlySet<string> = () => new Set()

  private constructor(
    readonly file: string,
    state: OAuthState,
    identity: FileIdentity | undefined,
  ) {
    this.current = state
    this.identity = identity
  }

  /**
   * Open the bound workspace's state file. A missing file is an empty state;
   * an unreadable or invalid one is a problem the caller reports, never a
   * reset.
   */
  static async open(): Promise<OAuthStore | OAuthStoreProblem> {
    const file = oauthStatePath()
    const read = await readStateFile(file)
    if (!read.ok) return { ...read.problem, file }
    return new OAuthStore(file, read.state, read.identity)
  }

  /**
   * Name the clients pruning must keep whatever their age: those with an
   * authorization code outstanding.
   */
  protectClients(inUse: () => ReadonlySet<string>): void {
    this.inUse = inUse
  }

  /** The state as last loaded or written, without checking the file. Treat as read-only. */
  get state(): Readonly<OAuthState> {
    return this.current
  }

  /** The current state, after checking the file for outside changes. */
  read(): Promise<Readonly<OAuthState>> {
    return this.enqueue(async () => {
      await this.sync()
      if (this.broken !== undefined) throw new OAuthStateUnavailableError(this.broken)
      return this.current
    })
  }

  /**
   * Apply `change` to a copy of the state, prune it as of `now`, persist it
   * when it changed, and make it current; resolves to what `change` returned.
   */
  update<T>(now: number, change: (draft: OAuthState) => T): Promise<T> {
    return this.enqueue(async () => {
      for (let attempt = 1; ; attempt++) {
        await this.sync()
        if (this.broken !== undefined) throw new OAuthStateUnavailableError(this.broken)
        const draft = structuredClone(this.current)
        const result = change(draft)
        pruneOAuthState(draft, now, this.inUse())
        const text = JSON.stringify(draft)
        const checked = parseOAuthState(text)
        if (isOAuthStateProblem(checked)) throw new OAuthStateInvariantError(checked)
        if (text === JSON.stringify(this.current)) return result
        let written: FileIdentity | 'unknown'
        try {
          written = await this.write(draft)
        } catch (error) {
          // Changed on disk since the check (rewritten, or deleted): apply the
          // change again to what is there now.
          if (error instanceof ConcurrentChangeError && attempt < MAX_WRITE_ATTEMPTS) continue
          throw error
        }
        this.current = draft
        this.identity = written
        return result
      }
    })
  }

  /**
   * Write `draft` atomically (`0600`): a temporary file in the same directory,
   * renamed over the target, so once the file exists there is never a moment
   * without it. Just before the rename, the target is checked against the
   * version this store last read or wrote: if another process changed,
   * replaced or deleted it meanwhile, the write is abandoned and the change
   * re-applied to what is there now, rather than written over it. (A change in
   * the instant between that check and the rename can still be lost; one
   * process should own the file.)
   *
   * Resolves to the identity of the version written, taken from the temporary
   * file just before the rename (a same-directory rename keeps its inode,
   * mtime and size): a stat of the target after the rename could see another
   * process's file renamed over it meanwhile and record that as this store's
   * own, so the next write would clobber it. A failed stat is `unknown`, which
   * only makes the next check reload the file.
   */
  private async write(draft: OAuthState): Promise<FileIdentity | 'unknown'> {
    const expected = this.identity
    let written: FileIdentity | 'unknown' = 'unknown'
    await ensureLoginsDir()
    await writeFileAtomic(this.file, `${JSON.stringify(draft, null, 2)}\n`, {
      mode: 0o600,
      beforeRename: async (tmpPath) => {
        if (expected === 'unknown' || !sameIdentity(await identityOf(this.file), expected)) {
          throw new ConcurrentChangeError()
        }
        written = (await identityOf(tmpPath).catch((): 'unknown' => 'unknown')) ?? 'unknown'
      },
    })
    return written
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run)
    // The chain must not stall on one failure; the caller still sees it.
    this.queue = next.catch(() => undefined)
    return next
  }

  /** Reload the file if it changed since this store last read or wrote it. */
  private async sync(): Promise<void> {
    let identity: FileIdentity | undefined
    try {
      identity = await identityOf(this.file)
    } catch (error) {
      if (this.broken === undefined) {
        console.error(
          describeOAuthStoreProblem({ problem: 'io', code: errorCode(error), file: this.file }),
        )
      }
      this.broken = { problem: 'io', code: errorCode(error), file: this.file }
      return
    }
    if (
      this.broken === undefined &&
      this.identity !== 'unknown' &&
      sameIdentity(identity, this.identity)
    ) {
      return
    }
    const read = await readStateFile(this.file)
    if (!read.ok) {
      if (this.broken === undefined) {
        // Once per breakage: from here no token verifies until it is fixed.
        console.error(describeOAuthStoreProblem({ ...read.problem, file: this.file }))
      }
      this.broken = { ...read.problem, file: this.file }
      this.current = emptyOAuthState()
      return
    }
    this.broken = undefined
    this.current = read.state
    this.identity = read.identity
  }
}

/** Whether {@link OAuthStore.open} returned a problem. */
export function isOAuthStoreProblem(
  value: OAuthStore | OAuthStoreProblem,
): value is OAuthStoreProblem {
  return !(value instanceof OAuthStore)
}
