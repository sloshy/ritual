import type { Component } from 'solid-js'
import { Show, createEffect, createSignal, on, onCleanup } from 'solid-js'
import { MenuButton } from '../ui/MenuButton'
import { useT } from '../ui/i18n'
import type { MessageKey } from '../i18n/messages/en'
import type { SyncMessageRef } from '../sync/message'
import { SyncMessageLines } from '../ui/SyncMessageLines'
import { downloadTextFile } from './editor/download'

const PANEL_WIDTH = 200
const FEEDBACK_MS = 1800

export type ExportFormat = 'txt' | 'md' | 'csv'

/**
 * Every key a format label may name. Narrower than `MessageKey` so `t()` can
 * render one without params, and `Extract` turns a key that no longer exists in
 * the catalog into `never` — a compile error at the table below.
 */
type FormatMessageKey = Extract<MessageKey, `site.export.format${string}`>

/**
 * A standard export format. `label` is a {@link MessageKey}, not rendered text:
 * this table is evaluated once at module load, so holding a string would freeze
 * the dropdown in whatever language was active when the bundle booted.
 */
type FormatOption = { value: ExportFormat; label: FormatMessageKey; mime: string }

const FORMATS: FormatOption[] = [
  { value: 'txt', label: 'site.export.formatTxt', mime: 'text/plain' },
  { value: 'md', label: 'site.export.formatMd', mime: 'text/markdown' },
  { value: 'csv', label: 'site.export.formatCsv', mime: 'text/csv' },
]

/**
 * A rendered extra export, plus any advisory problems worth showing — held
 * unrendered and worded in the menu's JSX, so a locale switch relabels them.
 */
export type ExtraExportResult = { content: string; warnings: readonly SyncMessageRef[] }

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
  /** What the export reports beside its content; empty for a standard format. */
  warnings: readonly SyncMessageRef[]
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
  const t = useT()
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

  // The last export's warnings, shown until another export replaces them. They
  // describe a file that was handed over, so they are set only once it was —
  // and cleared when the extras go away (sell mode turned off), since the file
  // they describe can no longer be made from this menu.
  const [warnings, setWarnings] = createSignal<readonly SyncMessageRef[]>([])
  createEffect(
    on(
      () => (props.extraFormats ?? []).length === 0,
      (noExtras) => {
        if (noExtras) setWarnings([])
      },
      { defer: true },
    ),
  )

  const entries = (): MenuEntry[] => [
    ...FORMATS.map((format): MenuEntry => ({ kind: 'format', label: t(format.label), format })),
    ...(props.extraFormats ?? []).map((extra): MenuEntry => ({
      kind: 'extra',
      label: extra.label,
      extra,
    })),
  ]

  /** Render an entry, with any advisory warnings it reports. */
  const render = (entry: MenuEntry): RenderedExport => {
    if (entry.kind === 'format') {
      return {
        content: props.serialize(entry.format.value),
        warnings: [],
        extension: entry.format.value,
        mime: entry.format.mime,
      }
    }
    const result = entry.extra.serialize()
    return {
      content: result.content,
      warnings: result.warnings,
      extension: entry.extra.extension,
      mime: entry.extra.mime,
    }
  }

  const handleCopy = async (entry: MenuEntry) => {
    const rendered = render(entry)
    try {
      await navigator.clipboard.writeText(rendered.content)
      setWarnings(rendered.warnings)
      flash(t('site.export.copied'))
    } catch {
      setWarnings([])
      flash(t('site.export.copyFailed'))
    }
  }

  const handleDownload = (entry: MenuEntry) => {
    const rendered = render(entry)
    downloadTextFile(
      `${safeFileName(props.name)}.${rendered.extension}`,
      rendered.content,
      rendered.mime,
    )
    setWarnings(rendered.warnings)
    flash(t('site.export.downloaded'))
  }

  return (
    <div class="export-menu">
      <ExportButton
        label={t('site.export.copy')}
        menuTitle={t('site.export.copyFormat')}
        entries={entries()}
        onPick={(e) => void handleCopy(e)}
      />
      <ExportButton
        label={t('site.export.download')}
        menuTitle={t('site.export.downloadFormat')}
        entries={entries()}
        onPick={handleDownload}
      />
      <Show when={feedback()}>
        {(message) => (
          <div class="export-feedback" role="status" aria-live="polite">
            {message()}
          </div>
        )}
      </Show>
      <SyncMessageLines messages={warnings()} class="export-warnings" />
    </div>
  )
}

type ExportButtonProps = {
  label: string
  /**
   * Title of the dropdown this button opens. A whole message rather than
   * `${label} format`: verb + noun concatenation does not survive translation.
   */
  menuTitle: string
  entries: MenuEntry[]
  onPick: (entry: MenuEntry) => void
}

/** A single export trigger button with its anchored format dropdown. */
const ExportButton: Component<ExportButtonProps> = (props) => (
  <div class="export-menu-control">
    <MenuButton
      items={props.entries.map((entry) => ({
        label: entry.label,
        onSelect: () => props.onPick(entry),
      }))}
      buttonClass="btn btn-secondary"
      trigger={(open) => (
        <>
          {props.label}
          <span aria-hidden="true">{open ? ' ▴' : ' ▾'}</span>
        </>
      )}
      title={props.menuTitle}
      width={PANEL_WIDTH}
    />
  </div>
)
