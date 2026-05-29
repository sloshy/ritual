import { type Accessor, batch, createMemo, createSignal, onMount } from 'solid-js'
import {
  cloneSets,
  combineSetsInto,
  deleteSetAt,
  parseChangeSets,
  retimeSetAt,
  serializeChangeSets,
  sortNewestFirst,
  type ChangeSet,
} from '../../../changelog-blocks'
import type { ListInfo } from '../../api/list-info'
import type {
  HistoryListsResponse,
  HistoryLoadResponse,
  HistorySaveResponse,
  HistoryErrorResponse,
} from '../../api/history'
import { type ListId, listInfoId } from '../list-grouping'

export type UseHistorySessionResult = {
  loaded: Accessor<boolean>
  error: Accessor<string | null>
  status: Accessor<string | null>
  saving: Accessor<boolean>

  lists: Accessor<ListInfo[]>
  selectedId: Accessor<ListId | null>
  selectedList: Accessor<ListInfo | null>
  /** Load (or clear) the list whose change history is being edited. */
  selectList: (id: ListId | null) => void
  detailLoading: Accessor<boolean>

  /** Current change sets in display order (newest first). */
  sets: Accessor<ChangeSet[]>
  dirty: Accessor<boolean>
  canUndo: Accessor<boolean>
  undoCount: Accessor<number>
  /** Whether a "rewrite with defaults" would produce any lines. */
  canRewrite: Accessor<boolean>

  originalSetCount: Accessor<number>
  originalLineCount: Accessor<number>
  lineCount: Accessor<number>

  deleteSet: (index: number) => void
  combineSets: (targetIndex: number, otherIndex: number) => void
  retimeSet: (index: number, timestamp: string) => void
  rewriteWithDefaults: () => void
  undo: () => void
  discard: () => void
  save: () => Promise<void>
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useHistorySession(): UseHistorySessionResult {
  const [loaded, setLoaded] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [status, setStatus] = createSignal<string | null>(null)
  const [saving, setSaving] = createSignal(false)

  const [lists, setLists] = createSignal<ListInfo[]>([])
  const [selectedId, setSelectedId] = createSignal<ListId | null>(null)
  const [detailLoading, setDetailLoading] = createSignal(false)

  const [header, setHeader] = createSignal('')
  const [defaultLines, setDefaultLines] = createSignal<string[]>([])
  const [sets, setSets] = createSignal<ChangeSet[]>([])
  const [originalSerialized, setOriginalSerialized] = createSignal('')
  const [undoStack, setUndoStack] = createSignal<ChangeSet[][]>([])

  const selectedList = createMemo(() => {
    const id = selectedId()
    return id ? (lists().find((l) => listInfoId(l) === id) ?? null) : null
  })

  // The list name is only used as a fallback header when the serialized form has
  // none, which never happens for a real changelog — but pass the name, not the
  // header text, so the fallback can't nest (`# Changelog for # Changelog for …`).
  const original = createMemo(() =>
    parseChangeSets(originalSerialized(), selectedList()?.name ?? ''),
  )
  const lineCount = createMemo(() => sets().reduce((n, s) => n + s.lines.length, 0))
  const originalSetCount = createMemo(() => original().sets.length)
  const originalLineCount = createMemo(() =>
    original().sets.reduce((n, s) => n + s.lines.length, 0),
  )

  const dirty = createMemo(() => {
    // Nothing is loaded yet — an empty editor is never "dirty" (and must not trip
    // the discard guard on the very first list selection).
    if (!selectedId()) return false
    return serializeChangeSets({ header: header(), sets: sets() }) !== originalSerialized()
  })
  const undoCount = createMemo(() => undoStack().length)
  const canUndo = createMemo(() => undoCount() > 0)
  const canRewrite = createMemo(() => defaultLines().length > 0)

  const reloadLists = async (): Promise<void> => {
    try {
      const resp = await fetch('/api/history', { credentials: 'same-origin' })
      const data = (await resp.json()) as HistoryListsResponse | HistoryErrorResponse
      if (!data.success) {
        setError(data.message)
        return
      }
      setLists(data.lists)
      setLoaded(true)
    } catch (err) {
      setError(`Failed to load lists: ${errorMessage(err)}`)
    }
  }

  onMount(() => void reloadLists())

  const loadDetail = async (list: ListInfo): Promise<void> => {
    setDetailLoading(true)
    setError(null)
    setStatus(null)
    try {
      const resp = await fetch(
        `/api/history/${encodeURIComponent(list.type)}/${encodeURIComponent(list.slug)}`,
        { credentials: 'same-origin' },
      )
      const data = (await resp.json()) as HistoryLoadResponse | HistoryErrorResponse
      if (!data.success) {
        setError(data.message)
        return
      }
      const loadedSets = sortNewestFirst(data.sets)
      setHeader(data.header)
      setDefaultLines(data.defaultLines)
      setSets(loadedSets)
      setOriginalSerialized(serializeChangeSets({ header: data.header, sets: loadedSets }))
      setUndoStack([])
    } catch (err) {
      setError(`Failed to load ${list.name}: ${errorMessage(err)}`)
    } finally {
      setDetailLoading(false)
    }
  }

  const selectList = (id: ListId | null): void => {
    setSelectedId(id)
    if (!id) {
      setSets([])
      setOriginalSerialized('')
      setUndoStack([])
      return
    }
    const list = lists().find((l) => listInfoId(l) === id)
    if (list) void loadDetail(list)
  }

  /** Snapshot the current sets for undo, then apply `next` (re-sorted newest first). */
  const applyMutation = (next: ChangeSet[]): void => {
    batch(() => {
      setUndoStack((stack) => [...stack, cloneSets(sets())])
      setSets(sortNewestFirst(next))
      setStatus(null)
    })
  }

  const deleteSet = (index: number): void => applyMutation(deleteSetAt(sets(), index))

  const combineSets = (targetIndex: number, otherIndex: number): void => {
    if (targetIndex === otherIndex) return
    applyMutation(combineSetsInto(sets(), targetIndex, otherIndex))
  }

  const retimeSet = (index: number, timestamp: string): void => {
    const current = sets()[index]
    if (!current || current.timestamp === timestamp) return
    applyMutation(retimeSetAt(sets(), index, timestamp))
  }

  const rewriteWithDefaults = (): void => {
    const lines = defaultLines()
    if (lines.length === 0) return
    applyMutation([{ timestamp: new Date().toISOString(), lines }])
  }

  const undo = (): void => {
    const stack = undoStack()
    const previous = stack[stack.length - 1]
    if (!previous) return
    batch(() => {
      setUndoStack(stack.slice(0, -1))
      setSets(sortNewestFirst(previous))
      setStatus(null)
    })
  }

  const discard = (): void => {
    batch(() => {
      setSets(
        sortNewestFirst(parseChangeSets(originalSerialized(), selectedList()?.name ?? '').sets),
      )
      setUndoStack([])
      setStatus(null)
    })
  }

  const save = async (): Promise<void> => {
    const list = selectedList()
    if (!list || !dirty()) return
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const resp = await fetch(
        `/api/history/${encodeURIComponent(list.type)}/${encodeURIComponent(list.slug)}/save`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sets: sets() }),
        },
      )
      const data = (await resp.json()) as HistorySaveResponse | HistoryErrorResponse
      if (!data.success) {
        setError(data.message)
        return
      }
      // The saved state is the new baseline; keep the in-memory sets as-is.
      setOriginalSerialized(serializeChangeSets({ header: header(), sets: sets() }))
      setUndoStack([])
      setStatus(data.message)
    } catch (err) {
      setError(`Failed to save: ${errorMessage(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return {
    loaded,
    error,
    status,
    saving,
    lists,
    selectedId,
    selectedList,
    selectList,
    detailLoading,
    sets,
    dirty,
    canUndo,
    undoCount,
    canRewrite,
    originalSetCount,
    originalLineCount,
    lineCount,
    deleteSet,
    combineSets,
    retimeSet,
    rewriteWithDefaults,
    undo,
    discard,
    save,
  }
}
