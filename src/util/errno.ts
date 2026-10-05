/**
 * Node errno narrowing, kept apart from `errors.ts` (which renders messages
 * through `src/i18n`) so the file writers under the persistence fence, which
 * reach it through `atomic-write`, never load the message catalog.
 */

/**
 * The errno codes Ritual actually branches on. A closed union rather than
 * `string` so a typo'd code (`'ENONET'`) is a compile error instead of a
 * permanently-dead branch.
 */
export type ErrnoCode =
  'ENOENT' | 'ENOTDIR' | 'EEXIST' | 'EPERM' | 'EPIPE' | 'EBUSY' | 'EACCES' | 'EXDEV'

/** A Node errno error whose `code` is known to be `C`. */
type ErrnoWithCode<C extends ErrnoCode> = NodeJS.ErrnoException & { code: C }

/**
 * Whether `error` is a Node system error carrying `code` (e.g. `'ENOENT'`).
 * Narrowing on the `code` property is the only way to tell "the file is not
 * there" from "reading it failed", which callers that treat absence as a
 * default — rather than as an error — have to distinguish.
 */
export function hasErrorCode<C extends ErrnoCode>(
  error: unknown,
  code: C,
): error is ErrnoWithCode<C> {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
