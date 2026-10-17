/**
 * The one failure for a value no branch of an exhaustive `switch` handles.
 *
 * The `never` parameter is the compile-time half: a new union member that an
 * arm forgot is a type error at the call. The throw is the runtime half, for a
 * value that slipped past the types (a cast, a stale persisted token). It is
 * still read by a human when it fires, so it is worded through the catalog
 * like any other error — one generic sentence, the stack trace saying where.
 */

import { t } from '../i18n/t'

/** Throw the "no case handles this value" error; never returns. */
export function assertNever(value: never): never {
  throw new Error(t('errors.invariant.unhandled', { value: describeUnhandled(value) }))
}

/** How much of an unhandled value the message quotes before it elides the rest. */
export const UNHANDLED_VALUE_MAX = 200

/**
 * The unhandled value as text, for an error a person reads: a string quoted as
 * JSON (so an empty or whitespace token is visible), an object's `kind` when it
 * has one (an event names itself), anything else as JSON, capped at
 * {@link UNHANDLED_VALUE_MAX} characters. Never throws — the error path must not
 * fail while describing the failure.
 */
export function describeUnhandled(value: unknown): string {
  const text = isKinded(value) ? safeJson(value.kind) : safeJson(value)
  return text.length > UNHANDLED_VALUE_MAX ? `${text.slice(0, UNHANDLED_VALUE_MAX)}…` : text
}

/** An object naming its own variant through a string `kind`. */
type Kinded = { kind: string }

function isKinded(value: unknown): value is Kinded {
  return (
    typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'
  )
}

/**
 * JSON when it can be had; otherwise the value's type tag
 * (`[object Function]`, `[object Symbol]`, `[object Object]` for a cycle) —
 * never a function's source, never a throw.
 */
function safeJson(value: unknown): string {
  if (typeof value === 'function' || typeof value === 'symbol') return typeTag(value)
  try {
    return JSON.stringify(value) ?? typeTag(value)
  } catch {
    return typeTag(value)
  }
}

function typeTag(value: unknown): string {
  return Object.prototype.toString.call(value)
}
