import { type Accessor, createSignal, createEffect, createMemo } from 'solid-js'
import type { Finish, Condition } from '../../../types'
import { isFinish, isCondition } from '../../../finish-condition'

export type EditorListKind = 'deck' | 'collection' | 'wanted'

/**
 * Defaults shape per list kind.
 *
 * Wanted lists do not track condition (they describe cards the user *wants*, not
 * cards they own), so the type does not allow `condition` for kind === 'wanted'.
 * Discriminating on `kind` lets the compiler reject any future call site that
 * tries to read or write a condition on the wanted shape.
 */
export type EditorDefaults =
  | { kind: 'deck'; sets: string[]; finish?: Finish; condition?: Condition }
  | { kind: 'collection'; sets: string[]; finish?: Finish; condition?: Condition }
  | { kind: 'wanted'; sets: string[]; finish?: Finish }

export type UseEditorDefaultsResult = {
  kind: EditorListKind
  defaults: Accessor<EditorDefaults>
  setSets: (codes: string[]) => void
  setFinish: (finish: Finish | undefined) => void
  setCondition: (condition: Condition | undefined) => void
  clear: () => void
  /** True when any default is active (sets non-empty, finish set, or condition set). */
  hasActive: Accessor<boolean>
}

const STORAGE_PREFIX = 'ritual:admin:defaults:'

type RawStored = {
  sets?: unknown
  finish?: unknown
  condition?: unknown
}

/**
 * Parse a raw localStorage payload into the kind-specific defaults shape.
 *
 * Returns the parsed shape on success, or a string error message on failure
 * (per the project's parser convention — see AGENTS.md). The caller is
 * expected to log the error and fall back to an empty default.
 *
 * Exported for unit testing; not part of the public hook API.
 */
export function parseStored(raw: string | null, kind: EditorListKind): EditorDefaults | string {
  if (!raw) return emptyDefaults(kind)
  let parsed: RawStored
  try {
    parsed = JSON.parse(raw) as RawStored
  } catch (e) {
    return `Failed to parse stored editor defaults: ${e instanceof Error ? e.message : String(e)}`
  }
  const sets = Array.isArray(parsed.sets)
    ? parsed.sets
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0)
    : []
  const finish =
    typeof parsed.finish === 'string' && isFinish(parsed.finish) ? parsed.finish : undefined

  if (kind === 'wanted') {
    return { kind, sets, finish }
  }
  const condition =
    typeof parsed.condition === 'string' && isCondition(parsed.condition)
      ? parsed.condition
      : undefined
  return { kind, sets, finish, condition }
}

function emptyDefaults(kind: EditorListKind): EditorDefaults {
  return kind === 'wanted' ? { kind, sets: [] } : { kind, sets: [] }
}

function loadStored(kind: EditorListKind): EditorDefaults {
  if (typeof localStorage === 'undefined') return emptyDefaults(kind)
  const result = parseStored(localStorage.getItem(`${STORAGE_PREFIX}${kind}`), kind)
  if (typeof result === 'string') {
    console.warn(`[editor-defaults] ${result}`)
    return emptyDefaults(kind)
  }
  return result
}

export function useEditorDefaults(kind: EditorListKind): UseEditorDefaultsResult {
  const [defaults, setDefaultsSignal] = createSignal<EditorDefaults>(loadStored(kind))

  createEffect(() => {
    const value = defaults()
    if (typeof localStorage === 'undefined') return
    const payload: RawStored = {
      sets: value.sets,
      finish: value.finish,
      condition: 'condition' in value ? value.condition : undefined,
    }
    localStorage.setItem(`${STORAGE_PREFIX}${kind}`, JSON.stringify(payload))
  })

  const setSets = (codes: string[]) => {
    const normalized = codes.map((c) => c.trim().toLowerCase()).filter((c) => c.length > 0)
    setDefaultsSignal((prev) => ({ ...prev, sets: normalized }))
  }

  const setFinish = (finish: Finish | undefined) => {
    setDefaultsSignal((prev) => ({ ...prev, finish }))
  }

  const setCondition = (condition: Condition | undefined) => {
    setDefaultsSignal((prev) => {
      if (prev.kind === 'wanted') return prev
      return { ...prev, condition }
    })
  }

  const clear = () => setDefaultsSignal(emptyDefaults(kind))

  const hasActive = createMemo(() => {
    const v = defaults()
    if (v.sets.length > 0) return true
    if (v.finish !== undefined) return true
    if (v.kind !== 'wanted' && v.condition !== undefined) return true
    return false
  })

  return { kind, defaults, setSets, setFinish, setCondition, clear, hasActive }
}

// Re-export the canonical set-code helpers so existing call sites keep working.
export { parseSetCodesInput, formatSetCodesForDisplay } from '../../../set-codes'
