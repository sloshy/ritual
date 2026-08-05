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

/** A rendered extra export, plus any advisory problems worth showing. */
export type ExtraExportResult = { content: string; warnings: string[] }

/**
 * An export entry offered alongside the standard formats — sell mode's
 * buyer-cart CSV. It carries its own serializer rather than widening
 * {@link ExportFormat}, so every page's `serialize` switch stays exhaustive over
 * the formats that page actually offers.
 */
export type ExtraExportFormat = {
  label: string
  /** Filename extension for downloads (no dot). */
  extension: string
  mime: string
  serialize: () => ExtraExportResult
}

export interface ExportMenuProps {
  /** Serialize the list to the chosen format. Run lazily, only when a format is picked. */
  serialize: (format: ExportFormat) => string
  /** The list's display name; sanitised into the downloaded file's base name. */
  name: string
  /** Extra entries appended after the standard formats; empty or absent hides them. */
  extraFormats?: readonly ExtraExportFormat[]
}

/** A rendered export ready to be copied or written to a file. */
type RenderedExport = {
  content: string
  /** Filename extension for downloads (no dot). */
  extension: string
  mime: string
}

/** One entry in a format dropdown: a standard format, or an extra with its own serializer. */
type MenuEntry =
  | { kind: 'format'; label: string; format: FormatOption }
  | { kind: 'extra'; label: string; extra: ExtraExportFormat }

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

  const [warnings, setWarnings] = createSignal<string[]>([])

  const entries = (): MenuEntry[] => [
    ...FORMATS.map((format): MenuEntry => ({ kind: 'format', label: format.label, format })),
    ...(props.extraFormats ?? []).map(
      (extra): MenuEntry => ({ kind: 'extra', label: extra.label, extra }),
    ),
  ]

  /** Render an entry, capturing any advisory warnings it reports. */
  const render = (entry: MenuEntry): RenderedExport => {
    if (entry.kind === 'format') {
      setWarnings([])
      return {
        content: props.serialize(entry.format.value),
        extension: entry.format.value,
        mime: entry.format.mime,
      }
    }
    const result = entry.extra.serialize()
    setWarnings(result.warnings)
    return { content: result.content, extension: entry.extra.extension, mime: entry.extra.mime }
  }

  const handleCopy = async (entry: MenuEntry) => {
    try {
      await navigator.clipboard.writeText(render(entry).content)
      flash('Copied!')
    } catch {
      flash('Copy failed')
    }
  }

  const handleDownload = (entry: MenuEntry) => {
    const rendered = render(entry)
    downloadTextFile(
      `${safeFileName(props.name)}.${rendered.extension}`,
      rendered.content,
      rendered.mime,
    )
    flash('Downloaded!')
  }

  return (
    <div class="export-menu">
      <ExportButton label="Copy" entries={entries()} onPick={(e) => void handleCopy(e)} />
      <ExportButton label="Download" entries={entries()} onPick={handleDownload} />
      <Show when={feedback()}>
        {(message) => (
          <div class="export-feedback" role="status" aria-live="polite">
            {message()}
          </div>
        )}
      </Show>
      <Show when={warnings().length > 0}>
        <div class="export-warnings" role="status" aria-live="polite">
          <For each={warnings()}>{(warning) => <p>{warning}</p>}</For>
        </div>
      </Show>
    </div>
  )
}

type ExportButtonProps = {
  label: string
  entries: MenuEntry[]
  onPick: (entry: MenuEntry) => void
}

/** A single export trigger button with its anchored format dropdown. */
const ExportButton: Component<ExportButtonProps> = (props) => {
  const toggle = useAnchoredToggle()

  const pick = (entry: MenuEntry) => {
    props.onPick(entry)
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
        <For each={props.entries}>
          {(entry) => (
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item"
              onClick={() => pick(entry)}
            >
              {entry.label}
            </button>
          )}
        </For>
      </AdaptiveMenu>
    </div>
  )
}
