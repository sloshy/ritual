import { type JSX, Show, batch, createEffect, createSignal, onMount, onCleanup } from 'solid-js'
import type { ChangeEvent } from '../../changes/change-event'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { useT } from '../../ui/i18n'
import {
  type ChangeBundleList,
  CHANGE_BUNDLE_FILENAME,
  bundleFromChangeGroups,
  serializeChangeBundle,
} from '../../changes/change-bundle'
import { resolveKnownListSlug } from './list-slug-resolver'
import type { ListType } from '../../list/list-type'
import type { ImportResult } from '../../editor/editor-config'
import { ImportChangesDialog } from '../../editor/components/ImportChangesDialog'
import type { BulkEditBundle } from '../selection-edit-actions'
import { type EditView, useEditChrome } from './edit-chrome'
import { setActiveEditSession } from './active-edit-session'
import {
  ExportPanel,
  type ExportListGroup,
  type ExportScope,
  type ListFileExport,
} from './ExportPanel'
import {
  saveEditSession,
  loadEditSession,
  clearEditSession,
  hasEditSession,
} from './edit-session-storage'
import {
  listEditSessions,
  needsDiscardConfirm,
  rememberEditSession,
  recallEditSession,
} from './edit-session-memory'

type EditViewFrameProps = {
  changeCount: number
  onDiscard: () => void
  onExit: () => void
  /** Filename for the downloaded change JSON when exporting just this list. */
  jsonFilename: string
  /** The list's kind, keying its sessions and change-bundle entries. */
  kind: ListType
  slug: string
  /** Display name of the list, labelling its edits in exports and sessions. */
  listName: string
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
  /**
   * Open the "Swap Printings" wizard over the whole list, published to the
   * navbar's edit row. Deck and collection editors only.
   */
  onSwapPrintings?: () => void
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
  const [exitConfirmOpen, setExitConfirmOpen] = createSignal(false)
  const [restorable, setRestorable] = createSignal<ChangeBundleList | null>(null)
  // Remembered in-memory edits awaiting (re)application once the editor has loaded.
  const [pendingImport, setPendingImport] = createSignal<ChangeEvent[] | null>(null)

  const editChrome = useEditChrome()
  const t = useT()

  /**
   * Leaving edit mode, confirming first when edits would be lost. The frame owns
   * the confirmation (rather than each editor calling `window.confirm`) because
   * it is the one component mounted for every public editor and it can host a
   * real dialog — a blocking browser prompt has no string a catalog can reach.
   */
  const requestExit = (): void => {
    if (needsDiscardConfirm(props.changeCount)) setExitConfirmOpen(true)
    else props.onExit()
  }

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
      // Presence decided at mount like kind/slug/bulkEdit below: whether a
      // host offers the swap is a property of the list type, fixed per mount.
      onSwapPrintings: props.onSwapPrintings ? () => props.onSwapPrintings?.() : undefined,
      onExit: requestExit,
    })
    // kind/slug/bulkEdit are stable per mount (one editor per list); remount the
    // frame to change them. The cross-list navbar reads this to apply removals live.
    setActiveEditSession({ kind: props.kind, slug: props.slug, bulkEdit: props.bulkEdit })

    setSavedExists(hasEditSession(props.kind, props.slug))
    const remembered = recallEditSession(props.kind, props.slug)
    if (remembered) {
      // This list was already edited this session (or targeted by a cross-list
      // removal): silently resume its in-memory edits once the editor is ready
      // (restoring needs the loaded data), no restore prompt.
      if (remembered.length > 0) setPendingImport(remembered)
    } else if (props.changeCount === 0) {
      // First time opening this list this session: offer to restore a session
      // previously saved to the browser (opt-in localStorage), if any.
      const saved = loadEditSession(props.kind, props.slug)
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
    rememberEditSession(props.kind, props.slug, props.listName, props.changes())
  })

  /** The open list's live pending edits, always fresher than its mirrored session. */
  const currentGroup = (): ExportListGroup => ({
    kind: props.kind,
    slug: props.slug,
    name: props.listName,
    changes: props.changes(),
  })

  /**
   * Every list with pending edits this session, with the open list's live changes
   * substituted for its (possibly not-yet-mirrored) remembered session.
   */
  const allEditedGroups = (): ExportListGroup[] => {
    const current = currentGroup()
    const others = listEditSessions().filter(
      (s) => !(s.kind === current.kind && s.slug === current.slug),
    )
    return current.changes.length > 0 ? [current, ...others] : others
  }

  const buildJson = (scope: ExportScope): string => {
    const lists = scope === 'current' ? [currentGroup()] : allEditedGroups()
    return serializeChangeBundle(
      bundleFromChangeGroups(lists, new Date().toISOString(), resolveKnownListSlug),
    )
  }

  const handleSaveToBrowser = (): void => {
    saveEditSession(currentGroup(), new Date().toISOString())
    setSavedExists(true)
  }

  const handleClearSaved = (): void => {
    clearEditSession(props.kind, props.slug)
    setSavedExists(false)
    setRestorable(null)
  }

  const handleRestore = (saved: ChangeBundleList): void => {
    props.onImport(saved.changes)
    setRestorable(null)
  }

  return (
    <div>
      <Show when={restorable()}>
        {(saved) => (
          <div class="edit-restore-bar" role="status">
            <span>{t('site.editor.restorePrompt', { count: saved().changes.length })}</span>
            <div class="edit-restore-actions">
              <button type="button" class="btn btn-export" onClick={() => handleRestore(saved())}>
                {t('site.editor.restore')}
              </button>
              <button type="button" class="btn btn-secondary" onClick={() => setRestorable(null)}>
                {t('site.editor.dismiss')}
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
        current={currentGroup()}
        allGroups={allEditedGroups}
        jsonFilename={props.jsonFilename}
        bundleFilename={CHANGE_BUNDLE_FILENAME}
        buildJson={buildJson}
        fileExports={props.fileExports}
        onSaveToBrowser={handleSaveToBrowser}
        onClearSaved={handleClearSaved}
        hasSavedSession={savedExists()}
      />

      <ImportChangesDialog
        open={importOpen()}
        onClose={() => setImportOpen(false)}
        expectedKind={props.kind}
        expectedSlug={props.slug}
        expectedName={props.listName}
        onImport={(changes) => props.onImport(changes)}
      />

      <ConfirmDialog
        open={exitConfirmOpen()}
        title={t('site.editor.exitTitle')}
        message={t('site.editor.exitMessage')}
        confirmLabel={t('site.editor.exitConfirm')}
        destructive
        onConfirm={() => {
          setExitConfirmOpen(false)
          props.onExit()
        }}
        onCancel={() => setExitConfirmOpen(false)}
      />
    </div>
  )
}
