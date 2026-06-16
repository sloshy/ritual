import { type JSX, Show, createSignal, onMount, onCleanup } from 'solid-js'
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
  /** The editor's bulk-edit bundle, registered as the active session for cross-list removal. */
  bulkEdit: BulkEditBundle
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

  const editChrome = useEditChrome()

  // Publish the edit controls to the navbar while this editor is mounted.
  onMount(() => {
    setSavedExists(hasEditSession(props.storageKind, props.slug))
    if (props.changeCount === 0) {
      const saved = loadEditSession(props.storageKind, props.slug)
      if (saved && saved.changes.length > 0) setRestorable(saved)
    }
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
    onCleanup(() => {
      editChrome.setCurrent(null)
      setActiveEditSession(null)
    })
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
              <button
                type="button"
                class="site-btn site-btn-export"
                onClick={() => handleRestore(file())}
              >
                Restore
              </button>
              <button
                type="button"
                class="site-btn site-btn-secondary"
                onClick={() => setRestorable(null)}
              >
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
