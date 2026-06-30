import { type Component, For, Show, createSignal, createEffect, onCleanup } from 'solid-js'
import { downloadTextFile } from './download'

/** A "download the updated list file" action (deck .txt, collection .md/.csv, etc.). */
export type ListFileExport = {
  label: string
  filename: string
  /** Built lazily so it reflects the latest edits when clicked. */
  build: () => string
  mime?: string
}

type ExportPanelProps = {
  open: boolean
  onClose: () => void
  changeCount: number
  /** Filename for the downloaded change-list JSON. */
  jsonFilename: string
  /** Built lazily so it reflects the latest edits when clicked. */
  buildJson: () => string
  /** Optional "download updated file" actions specific to the list type. */
  fileExports?: ListFileExport[]
  /** Persist the current edits to this browser (opt-in localStorage). */
  onSaveToBrowser?: () => void
  /** Remove any saved session for this list. */
  onClearSaved?: () => void
  /** Whether a saved session currently exists (shows the Clear action). */
  hasSavedSession?: boolean
}

/**
 * The public editor's "commit" surface. Instead of saving to a server, it lets the
 * visitor download or copy their edits: a change-list JSON (which can be imported
 * into the admin editor) and/or an updated list file with the edits applied.
 */
export const ExportPanel: Component<ExportPanelProps> = (props) => {
  const [copied, setCopied] = createSignal(false)
  const [saved, setSaved] = createSignal(false)

  // Reset the transient labels each time the panel reopens.
  createEffect(() => {
    if (props.open) {
      setCopied(false)
      setSaved(false)
    }
  })

  // Close on Escape, matching the site's other dialogs.
  createEffect(() => {
    if (!props.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => document.removeEventListener('keydown', onKey))
  })

  const downloadJson = () => {
    downloadTextFile(props.jsonFilename, props.buildJson(), 'application/json')
  }

  const copyJson = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.buildJson())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Show when={props.open}>
      <div
        class="export-panel-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose()
        }}
      >
        <div class="export-panel" role="dialog" aria-modal="true" aria-label="Export your edits">
          <div class="export-panel-header">
            <h3 class="export-panel-title">Export your edits</h3>
            <button
              type="button"
              class="export-panel-close"
              aria-label="Close"
              onClick={props.onClose}
            >
              ×
            </button>
          </div>

          <p class="export-panel-count">
            {props.changeCount} {props.changeCount === 1 ? 'change' : 'changes'}
          </p>

          <div class="export-panel-actions">
            <button
              type="button"
              class="btn btn-secondary"
              disabled={props.changeCount === 0}
              onClick={downloadJson}
            >
              Download change list (JSON)
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              disabled={props.changeCount === 0}
              onClick={() => void copyJson()}
            >
              {copied() ? 'Copied!' : 'Copy JSON'}
            </button>
            <For each={props.fileExports ?? []}>
              {(fx) => (
                <button
                  type="button"
                  class="btn btn-secondary"
                  onClick={() => downloadTextFile(fx.filename, fx.build(), fx.mime)}
                >
                  {fx.label}
                </button>
              )}
            </For>
          </div>

          <p class="export-panel-hint">
            Import the JSON into the admin editor to review and apply these changes.
          </p>

          <Show when={props.onSaveToBrowser != null}>
            <div class="export-panel-persist">
              <div class="export-panel-actions">
                <button
                  type="button"
                  class="btn btn-secondary"
                  disabled={props.changeCount === 0}
                  onClick={() => {
                    props.onSaveToBrowser?.()
                    setSaved(true)
                    setTimeout(() => setSaved(false), 2000)
                  }}
                >
                  {saved() ? 'Saved to browser ✓' : 'Save edits to this browser'}
                </button>
                <Show when={props.hasSavedSession}>
                  <button
                    type="button"
                    class="btn btn-secondary"
                    onClick={() => props.onClearSaved?.()}
                  >
                    Clear saved edits
                  </button>
                </Show>
              </div>
              <p class="export-panel-hint">
                Saved only in this browser (localStorage) until you clear it — never uploaded.
              </p>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
