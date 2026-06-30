import { type JSX, Show, batch, createEffect, createSignal, onMount, onCleanup } from 'solid-js'
import type { ChangeEvent } from '../../change-event'
import { type ChangeFile, type ChangeFileKind, serializeChangeFile } from '../../editor/change-file'
import type { ImportResult } from '../../editor/useEditor'
import { ImportChangesDialog } from '../../editor/components/ImportChangesDialog'
import type { BulkEditBundle } from '../selection-edit-actions'
import { type EditView, useEditChrome } from './edit-chrome'
import { setActiveEditSession } from './active-edit-session'
import { ExportPanel, type ListFileExport } from './ExportPanel'
import {
  saveEditSession,
  loadEditSession,
  clearEditSession,
  hasEditSession,
} from './edit-session-storage'
import { rememberEditSession, recallEditSession } from './edit-session-memory'

type EditViewFrameProps = {
  changeCount: number
  onDiscard: () => void
  onExit: () => void
  jsonFilename: string
  /** Build the current edit session as a change file (serialized for export, stored for save). */
  buildFile: () => ChangeFile
  /** List kind + slug, used to key the opt-in localStorage session. */
  storageKind: ChangeFileKind
  slug: string
  /**
   * Apply a change list (re-targeted to current card IDs) into the live editor,
   * returning the import outcome. Backs both restoring a saved session and the
   * Load Changes dialog.
   */
  onImport: (changes: ChangeEvent[]) => ImportResult
  /**
   * Resume an in-memory edit session verbatim (no re-targeting). Used to restore a
   * list's pending edits when it is reopened after navigating away, preserving exact
   * card IDs — unlike {@link onImport}, which re-aims an externally-authored file.
   */
  onRestore: (changes: ChangeEvent[]) => void
  /** The editor's bulk-edit bundle, registered as the active session for cross-list removal. */
  bulkEdit: BulkEditBundle
  /** The editor's live change list, mirrored into the in-memory session so edits survive navigation. */
  changes: () => ChangeEvent[]
  /** Whether the editor has finished loading its data (so remembered edits can be re-targeted). */
  ready: () => boolean
  fileExports?: ListFileExport[]
  /** The editor (edit mode) — shown for the 'edited' view. */
  edited: JSX.Element
  /** The read-only published view — shown for the 'original' view. */
  original: JSX.Element
}

/**
 * Shared shell for the public list editors (deck/collection/wanted). It owns the
 * Original/Edited view toggle, the export panel, the restore-saved-session prompt,
 * and opt-in browser persistence — but the visible controls live in the navbar's
 * edit row: this frame registers them via the {@link useEditChrome} store on mount
 * and clears them on unmount. The editor's state lives here (in the caller's
 * controller), so toggling to Original and back preserves pending edits.
 */
export function EditViewFrame(props: EditViewFrameProps): JSX.Element {
  const [view, setView] = createSignal<EditView>('edited')
  const [exportOpen, setExportOpen] = createSignal(false)
  const [importOpen, setImportOpen] = createSignal(false)
  const [savedExists, setSavedExists] = createSignal(false)
  const [restorable, setRestorable] = createSignal<ChangeFile | null>(null)
  // Remembered in-memory edits awaiting (re)application once the editor has loaded.
  const [pendingImport, setPendingImport] = createSignal<ChangeEvent[] | null>(null)

  const editChrome = useEditChrome()

  // Publish the edit controls to the navbar while this editor is mounted. Register
  // the chrome and active session first, then decide what (if anything) to restore —
  // so the frame is fully wired before any restore could apply.
  onMount(() => {
    editChrome.setCurrent({
      changeCount: () => props.changeCount,
      view,
      setView,
      onDiscard: () => props.onDiscard(),
      onExport: () => setExportOpen(true),
      onLoadChanges: () => setImportOpen(true),
      onExit: () => props.onExit(),
    })
    // kind/slug/bulkEdit are stable per mount (one editor per list); remount the
    // frame to change them. The cross-list navbar reads this to apply removals live.
    setActiveEditSession({ kind: props.storageKind, slug: props.slug, bulkEdit: props.bulkEdit })

    setSavedExists(hasEditSession(props.storageKind, props.slug))
    const remembered = recallEditSession(props.storageKind, props.slug)
    if (remembered) {
      // This list was already edited this session (or targeted by a cross-list
      // removal): silently resume its in-memory edits once the editor is ready
      // (restoring needs the loaded data), no restore prompt.
      if (remembered.length > 0) setPendingImport(remembered)
    } else if (props.changeCount === 0) {
      // First time opening this list this session: offer to restore a session
      // previously saved to the browser (opt-in localStorage), if any.
      const saved = loadEditSession(props.storageKind, props.slug)
      if (saved && saved.changes.length > 0) setRestorable(saved)
    }

    onCleanup(() => {
      editChrome.setCurrent(null)
      setActiveEditSession(null)
    })
  })

  // Apply remembered edits once the editor has loaded (so the change list can be
  // replayed against the baseline). The load itself discards pending changes, so
  // this must wait for readiness rather than fire during mount. The restore and the
  // pending-flag clear are batched so the mirror effect below re-runs only once,
  // after the restored changes are in place.
  createEffect(() => {
    const remembered = pendingImport()
    if (remembered && props.ready()) {
      batch(() => {
        props.onRestore(remembered)
        setPendingImport(null)
      })
    }
  })

  // Mirror the live edits into the in-memory session so they survive navigating to
  // another list and back. Held off until the editor is ready and any remembered
  // edits have been restored, so an unloaded editor never overwrites a list's saved
  // session with an empty change list. Unmounting (navigation) leaves the last value
  // in place; exiting edit mode clears every session (see app's exitEditMode).
  createEffect(() => {
    if (!props.ready() || pendingImport()) return
    rememberEditSession(props.storageKind, props.slug, props.changes())
  })

  const buildJson = (): string => serializeChangeFile(props.buildFile())

  const handleSaveToBrowser = (): void => {
    saveEditSession(props.buildFile())
    setSavedExists(true)
  }

  const handleClearSaved = (): void => {
    clearEditSession(props.storageKind, props.slug)
    setSavedExists(false)
    setRestorable(null)
  }

  const handleRestore = (file: ChangeFile): void => {
    props.onImport(file.changes)
    setRestorable(null)
  }

  return (
    <div>
      <Show when={restorable()}>
        {(file) => (
          <div class="edit-restore-bar" role="status">
            <span>
              You saved edits to this list in this browser ({file().changes.length}{' '}
              {file().changes.length === 1 ? 'change' : 'changes'}). Restore them?
            </span>
            <div class="edit-restore-actions">
              <button type="button" class="btn btn-export" onClick={() => handleRestore(file())}>
                Restore
              </button>
              <button type="button" class="btn btn-secondary" onClick={() => setRestorable(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}
      </Show>

      <Show when={view() === 'edited'} fallback={props.original}>
        {props.edited}
      </Show>

      <ExportPanel
        open={exportOpen()}
        onClose={() => setExportOpen(false)}
        changeCount={props.changeCount}
        jsonFilename={props.jsonFilename}
        buildJson={buildJson}
        fileExports={props.fileExports}
        onSaveToBrowser={handleSaveToBrowser}
        onClearSaved={handleClearSaved}
        hasSavedSession={savedExists()}
      />

      <ImportChangesDialog
        open={importOpen()}
        onClose={() => setImportOpen(false)}
        expectedKind={props.storageKind}
        onImport={(file) => props.onImport(file.changes)}
      />
    </div>
  )
}
