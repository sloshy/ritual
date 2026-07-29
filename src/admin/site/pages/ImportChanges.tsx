import { type JSX, For, Match, Show, Switch, createMemo, createSignal } from 'solid-js'
import { StatusAlerts } from '../components/StatusAlerts'
import { formatChange } from '../../../change-event'
import { LIST_TYPE_DISPLAY, listTypeLabel } from '../../../list-type'
import {
  type ChangeBundle,
  bundleChangeCount,
  countLabel,
  parseChangeBundle,
} from '../../../editor/change-bundle'
import type { BundleImportResponse, BundleImportResult } from '../../api/import-changes'
import type { ApiErrorResponse } from '../../api/save-helpers'
import { PageHeading } from '../components/PageHeading'

type SourceMethod = 'upload' | 'text'

type MethodOption = { id: SourceMethod; label: string }

const METHODS: MethodOption[] = [
  { id: 'upload', label: 'Upload File' },
  { id: 'text', label: 'Paste Text' },
]

/**
 * The import route's response: per-list outcomes plus a human-readable summary,
 * or the shared refusal envelope when the bundle never got as far as applying.
 * A partial import answers 200 with `success: true` and a non-zero
 * `failedCount`, so the per-list report survives to be rendered.
 */
type ApplyResponse = BundleImportResponse | ApiErrorResponse

/**
 * Admin page to apply a change bundle exported from the public site's
 * edit mode. The JSON is parsed locally for a full per-list preview of every
 * pending change; applying POSTs the raw text to `/api/import-changes`, which
 * re-targets and saves each list's changes and reports per-list outcomes.
 */
export function ImportChanges(): JSX.Element {
  const [method, setMethod] = createSignal<SourceMethod>('upload')
  const [fileName, setFileName] = createSignal('')
  const [fileContent, setFileContent] = createSignal('')
  const [text, setText] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [status, setStatus] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [result, setResult] = createSignal<BundleImportResult | null>(null)

  const content = createMemo((): string => (method() === 'upload' ? fileContent() : text()))

  const parsed = createMemo((): ChangeBundle | string | null => {
    const value = content().trim()
    return value === '' ? null : parseChangeBundle(value)
  })
  const parseError = createMemo((): string | null => {
    const bundle = parsed()
    return typeof bundle === 'string' ? bundle : null
  })
  const bundle = createMemo((): ChangeBundle | null => {
    const value = parsed()
    return value !== null && typeof value !== 'string' ? value : null
  })
  const totalChanges = createMemo((): number => {
    const value = bundle()
    return value ? bundleChangeCount(value) : 0
  })

  const handleFileChange = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    if (!file) return
    setFileContent(await file.text())
    setFileName(file.name)
    setResult(null)
    setStatus(null)
    setError(null)
  }

  const handleApply = async () => {
    const value = bundle()
    if (!value || loading()) return
    setLoading(true)
    setStatus(null)
    setError(null)
    setResult(null)
    try {
      const resp = await fetch('/api/import-changes', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: content(),
      })
      const data = (await resp.json()) as ApplyResponse
      if (!data.success) {
        setError(data.message || 'Failed to apply changes')
        return
      }
      setResult(data)
      // A list that failed to load or save still leaves a report worth showing,
      // so the banner is the only thing that changes.
      if (data.failedCount > 0) setError(data.message)
      else setStatus(data.message || 'Changes applied')
    } catch {
      setError('Failed to apply changes')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PageHeading page="import-changes" />
      <p class="text-muted">
        Apply a change bundle exported from the site editor, covering one or more lists. Review the
        pending changes below, then apply them to your list files.
      </p>
      <StatusAlerts status={status()} error={error()} />

      <Show when={result()}>
        {(r) => (
          <div class="import-changes-results">
            <For each={r().lists}>
              {(list) => (
                <div class="import-changes-result" data-error={list.error ? 'true' : undefined}>
                  <span class="import-changes-result-heading">
                    {list.error ? '✗' : '✓'} {LIST_TYPE_DISPLAY[list.kind].icon} {list.name}
                  </span>
                  <Show
                    when={!list.error}
                    fallback={<span class="import-changes-result-error">{list.error}</span>}
                  >
                    <span>applied {countLabel(list.applied, 'change')}</span>
                  </Show>
                  <Show when={list.conflicts.length > 0}>
                    <ul class="import-changes-conflicts">
                      <For each={list.conflicts}>
                        {(c) => <li>⚠ Skipped (card not found): {formatChange(c.change)}</li>}
                      </For>
                    </ul>
                  </Show>
                </div>
              )}
            </For>
          </div>
        )}
      </Show>

      <div class="form-container">
        <div class="segmented" role="group" aria-label="JSON source">
          <For each={METHODS}>
            {(m) => (
              <button
                type="button"
                class="segmented-option"
                data-active={method() === m.id}
                aria-pressed={method() === m.id}
                onClick={() => setMethod(m.id)}
              >
                {m.label}
              </button>
            )}
          </For>
        </div>

        <Switch>
          <Match when={method() === 'upload'}>
            <div>
              <label class="form-label">Change bundle (JSON)</label>
              <div class="file-input-row">
                <label class="btn btn-secondary">
                  Choose File
                  <input
                    type="file"
                    class="file-input-hidden"
                    accept="application/json,.json"
                    onChange={(e) => void handleFileChange(e.currentTarget)}
                  />
                </label>
                <span class="file-input-name">{fileName() || 'No file selected'}</span>
              </div>
              <p class="form-hint form-hint-top">
                An export from the site editor's Export panel (single list or all lists)
              </p>
            </div>
          </Match>
          <Match when={method() === 'text'}>
            <div>
              <label class="form-label">Change JSON</label>
              <textarea
                class="form-input form-textarea"
                value={text()}
                onInput={(e) => {
                  setText(e.currentTarget.value)
                  setResult(null)
                  setStatus(null)
                  setError(null)
                }}
                placeholder='{"format": "ritual-change-bundle", ...}'
              />
            </div>
          </Match>
        </Switch>

        <Show when={parseError()}>
          <div class="alert alert-error">Invalid change bundle: {parseError()}</div>
        </Show>

        <Show when={bundle()}>
          {(b) => (
            <>
              <div>
                <label class="form-label">
                  Pending changes — {countLabel(totalChanges(), 'change')} across{' '}
                  {countLabel(b().lists.length, 'list')}
                </label>
                <div class="import-changes-preview">
                  <For each={b().lists}>
                    {(list) => (
                      <div class="import-changes-preview-group">
                        <div class="import-changes-preview-list">
                          {LIST_TYPE_DISPLAY[list.kind].icon} {list.name} (
                          {listTypeLabel(list.kind)} '{list.slug}') —{' '}
                          {countLabel(list.changes.length, 'change')}
                        </div>
                        <ul class="import-changes-preview-changes">
                          <For each={list.changes}>
                            {(change) => <li>{formatChange(change)}</li>}
                          </For>
                        </ul>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              <button
                type="button"
                class="btn btn-primary"
                disabled={loading() || totalChanges() === 0}
                onClick={() => void handleApply()}
              >
                {loading()
                  ? 'Applying...'
                  : `Apply ${countLabel(totalChanges(), 'change')} to ${countLabel(b().lists.length, 'list')}`}
              </button>
            </>
          )}
        </Show>
      </div>
    </div>
  )
}
