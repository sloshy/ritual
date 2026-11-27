import { createSignal, type Accessor, type Setter, type SignalOptions } from 'solid-js'

/**
 * A signal whose read always answers the last write.
 *
 * A Solid signal read shows a write only once the update has flushed (the next
 * microtask), which is what keeps every reader of one update consistent. Some
 * state is also read imperatively by the code that just wrote it, in the same
 * handler: the editor's data (did that removal take the last line of a name?),
 * the staged art an undo record captures, the API base a boot fetch goes
 * through. For that state this keeps the written value beside the signal. The
 * accessor still subscribes to the signal, so reactive readers re-run on the
 * flush exactly as before; they just never see an older value than the code
 * around them.
 *
 * Only for synchronous, local state: nothing here is ever async or held by a
 * transition, so "the last write" and "the value about to be committed" agree.
 * Never write one inside an `action()`, or in a frame whose writes feed an
 * async computation (an async or lazy memo, a projection): a held transition
 * would keep the signal's committed value while this answers the pending one,
 * and readers would tear. Re-audit every latest signal before introducing an
 * async computation that reads it. (Solid exposes no cheap way to detect an
 * action context, so this is not guarded at runtime.)
 *
 * Only the accessor is latest-valued. A `createMemo` over it still answers
 * from before the write until the flush, so state a handler reads back must be
 * read through the accessor (or a plain function over it), never a memo.
 */
export function createLatestSignal<T>(
  initial: Exclude<T, Function>,
  options?: SignalOptions<T>,
): [Accessor<T>, Setter<T>] {
  const [tracked, setTracked] = createSignal<T>(initial, options)
  let latest: T = initial
  const read: Accessor<T> = () => {
    tracked()
    return latest
  }
  // A `Setter` in every form: a value, an update from the latest value, or
  // (where `undefined` is allowed) nothing at all.
  const write = ((next?: T | ((prev: T) => T)): T => {
    const value = typeof next === 'function' ? (next as (prev: T) => T)(latest) : (next as T)
    // The graph first: if the write throws (a dev diagnostic), the latest value
    // must not run ahead of it.
    setTracked(() => value)
    latest = value
    return value
  }) as Setter<T>
  return [read, write]
}
