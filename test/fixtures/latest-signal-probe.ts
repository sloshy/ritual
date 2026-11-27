/**
 * Run by `test/integration/latest-signal.test.ts` under `bun --conditions=browser`,
 * so `solid-js` is Solid's client reactive core, where a write shows to plain
 * reads only after the flush. Prints what each read answered, as JSON.
 */
import { createMemo, createRoot, createSignal, flush } from 'solid-js'
import { createLatestSignal } from '../../src/ui/latest-signal'

/** Each read the probe makes, by name. */
export type LatestSignalProbe = {
  latestBeforeFlush: number
  plainBeforeFlush: number
  memoBeforeFlush: number
  memoAfterFlush: number
  chained: readonly string[]
  clearedReturn: number | undefined
  clearedRead: number | undefined
}

const probe = createRoot((dispose): LatestSignalProbe => {
  const [latest, setLatest] = createLatestSignal<number>(1)
  const [plain, setPlain] = createSignal(1)
  const doubled = createMemo(() => latest() * 2)
  setLatest(5)
  setPlain(5)
  const latestBeforeFlush = latest()
  const plainBeforeFlush = plain()
  const memoBeforeFlush = doubled()
  flush()
  const memoAfterFlush = doubled()

  const [items, setItems] = createLatestSignal<readonly string[]>([])
  setItems((prev) => [...prev, 'a'])
  setItems((prev) => [...prev, 'b'])

  const [maybe, setMaybe] = createLatestSignal<number | undefined>(3)
  const clearedReturn = setMaybe()
  const result: LatestSignalProbe = {
    latestBeforeFlush,
    plainBeforeFlush,
    memoBeforeFlush,
    memoAfterFlush,
    chained: items(),
    clearedReturn,
    clearedRead: maybe(),
  }
  dispose()
  return result
})

console.log(JSON.stringify(probe))
