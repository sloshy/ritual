import type { Component } from 'solid-js'
import { For, Show, createSignal, onCleanup } from 'solid-js'
import { AdaptiveMenu } from '../ui/AdaptiveMenu'
import { useAnchoredToggle } from '../ui/useAnchoredToggle'
import { downloadTextFile } from './editor/download'

const PANEL_WIDTH = 200
const FEEDBACK_MS = 1800

export type ExportFormat = 'txt' | 'md' | 'csv'

type FormatOption = { value: ExportFormat; label: string; mime: string }

const FORMATS: FormatOption[] = [
  { value: 'txt', label: 'Text (.txt)', mime: 'text/plain' },
  { value: 'md', label: 'Markdown (.md)', mime: 'text/markdown' },
  { value: 'csv', label: 'CSV (.csv)', mime: 'text/csv' },
]

export interface ExportMenuProps {
  /** Serialize the list to the chosen format. Run lazily, only when a format is picked. */
  serialize: (format: ExportFormat) => string
  /** The list's display name; sanitised into the downloaded file's base name. */
  name: string
}

/** Strip a display name down to a filesystem-friendly base for downloads. */
const safeFileName = (name: string): string =>
  name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'list'

/**
 * The page-header export controls: a **Copy** and a **Download** button that each
 * open a dropdown of formats (TXT / MD / CSV). Picking a format copies the
 * serialized list to the clipboard or downloads it as a file, then flashes a small
 * confirmation tooltip — the button labels themselves never change. Used by the
 * deck, collection, and wanted-list read views.
 */
export const ExportMenu: Component<ExportMenuProps> = (props) => {
  const [feedback, setFeedback] = createSignal<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  const flash = (message: string) => {
    if (timer !== null) clearTimeout(timer)
    setFeedback(message)
    timer = setTimeout(() => {
      setFeedback(null)
      timer = null
    }, FEEDBACK_MS)
  }
  onCleanup(() => {
    if (timer !== null) clearTimeout(timer)
  })

  const handleCopy = async (format: ExportFormat) => {
    try {
      await navigator.clipboard.writeText(props.serialize(format))
      flash('Copied!')
    } catch {
      flash('Copy failed')
    }
  }

  const handleDownload = (format: FormatOption) => {
    downloadTextFile(
      `${safeFileName(props.name)}.${format.value}`,
      props.serialize(format.value),
      format.mime,
    )
    flash('Downloaded!')
  }

  return (
    <div class="export-menu">
      <ExportButton label="Copy" onPick={(f) => void handleCopy(f.value)} />
      <ExportButton label="Download" onPick={handleDownload} />
      <Show when={feedback()}>
        {(message) => (
          <div class="export-feedback" role="status" aria-live="polite">
            {message()}
          </div>
        )}
      </Show>
    </div>
  )
}

type ExportButtonProps = {
  label: string
  onPick: (format: FormatOption) => void
}

/** A single export trigger button with its anchored format dropdown. */
const ExportButton: Component<ExportButtonProps> = (props) => {
  const toggle = useAnchoredToggle()

  const pick = (format: FormatOption) => {
    props.onPick(format)
    toggle.close()
  }

  return (
    <div class="export-menu-control">
      <button
        type="button"
        ref={toggle.setButtonRef}
        class="btn btn-secondary"
        aria-haspopup="true"
        aria-expanded={toggle.open()}
        onClick={toggle.toggleOpen}
      >
        {props.label}
        <span aria-hidden="true">{toggle.open() ? ' ▴' : ' ▾'}</span>
      </button>
      <AdaptiveMenu
        toggle={toggle}
        width={PANEL_WIDTH}
        panelClass="selection-menu-panel"
        title={`${props.label} format`}
        role="menu"
        aria-label={`${props.label} format`}
      >
        <For each={FORMATS}>
          {(format) => (
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item"
              onClick={() => pick(format)}
            >
              {format.label}
            </button>
          )}
        </For>
      </AdaptiveMenu>
    </div>
  )
}
