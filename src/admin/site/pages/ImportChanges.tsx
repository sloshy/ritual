import { type JSX, For, Match, Show, Switch, createMemo, createSignal } from 'solid-js'
import { StatusAlerts } from '../components/StatusAlerts'
import { IMPORT_CONFLICT_REASON_KEY } from '../../../editor/import-changes'
import { formatChange } from '../../../change-message'
import { LIST_TYPE_DISPLAY } from '../../../list-type'
import {
  type ChangeBundle,
  bundleChangeCount,
  parseChangeBundle,
} from '../../../editor/change-bundle'
import { useT, useTKey } from '../../../ui/i18n'
import type { BundleImportResponse, BundleImportResult } from '../../api/import-changes'
import type { ApiErrorResponse } from '../../api/save-helpers'
import { PageHeading } from '../components/PageHeading'
import type { ParameterlessKey } from '../../../i18n/t'

type SourceMethod = 'upload' | 'text'

/** One tab of the source picker; `labelKey` is a {@link MessageKey}, resolved at render time. */
type MethodOption = { id: SourceMethod; labelKey: ParameterlessKey }

const METHODS: MethodOption[] = [
  { id: 'upload', labelKey: 'admin.import.upload' },
  { id: 'text', labelKey: 'admin.import.pasteText' },
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
  const t = useT()
  const tKey = useTKey()
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
        setError(data.message || t('admin.importChanges.applyFailed'))
        return
      }
      setResult(data)
      // A list that failed to load or save still leaves a report worth showing,
      // so the banner is the only thing that changes.
      if (data.failedCount > 0) setError(data.message)
      else setStatus(data.message || t('admin.importChanges.applied'))
    } catch {
      setError(t('admin.importChanges.applyFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PageHeading page="import-changes" />
      <p class="text-muted">{t('admin.importChanges.desc')}</p>
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
                    <span>{t('admin.importChanges.appliedCount', { count: list.applied })}</span>
                  </Show>
                  <Show when={list.conflicts.length > 0}>
                    <ul class="import-changes-conflicts">
                      <For each={list.conflicts}>
                        {(c) => (
                          <li>
                            ⚠{' '}
                            {t('admin.importChanges.skipped', {
                              reason: t(IMPORT_CONFLICT_REASON_KEY[c.reason]),
                              change: formatChange(c.change),
                            })}
                          </li>
                        )}
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
        <div class="segmented" role="group" aria-label={t('admin.importChanges.sourceLabel')}>
          <For each={METHODS}>
            {(m) => (
              <button
                type="button"
                class="segmented-option"
                data-active={method() === m.id}
                aria-pressed={method() === m.id}
                onClick={() => setMethod(m.id)}
              >
                {tKey(m.labelKey)}
              </button>
            )}
          </For>
        </div>

        <Switch>
          <Match when={method() === 'upload'}>
            <div>
              <label class="form-label">{t('admin.importChanges.fileLabel')}</label>
              <div class="file-input-row">
                <label class="btn btn-secondary">
                  {t('admin.import.chooseFile')}
                  <input
                    type="file"
                    class="file-input-hidden"
                    accept="application/json,.json"
                    onChange={(e) => void handleFileChange(e.currentTarget)}
                  />
                </label>
                <span class="file-input-name">{fileName() || t('admin.import.noFile')}</span>
              </div>
              <p class="form-hint form-hint-top">{t('admin.importChanges.fileHint')}</p>
            </div>
          </Match>
          <Match when={method() === 'text'}>
            <div>
              <label class="form-label">{t('admin.importChanges.textLabel')}</label>
              <textarea
                class="form-input form-textarea"
                value={text()}
                onInput={(e) => {
                  setText(e.currentTarget.value)
                  setResult(null)
                  setStatus(null)
                  setError(null)
                }}
                // i18n-exempt: the bundle's own JSON shape, a machine contract.
                placeholder='{"format": "ritual-change-bundle", ...}'
              />
            </div>
          </Match>
        </Switch>

        <Show when={parseError()}>
          <div class="alert alert-error">
            {t('admin.importChanges.invalid', { reason: parseError() ?? '' })}
          </div>
        </Show>

        <Show when={bundle()}>
          {(b) => (
            <>
              <div>
                <label class="form-label">
                  {t('admin.importChanges.pendingLabel', {
                    changes: t('ui.count.changes', { count: totalChanges() }),
                    lists: t('ui.count.lists', { count: b().lists.length }),
                  })}
                </label>
                <div class="import-changes-preview">
                  <For each={b().lists}>
                    {(list) => (
                      <div class="import-changes-preview-group">
                        <div class="import-changes-preview-list">
                          {LIST_TYPE_DISPLAY[list.kind].icon}{' '}
                          {t('admin.importChanges.previewList', {
                            listType: list.kind,
                            name: list.name,
                            slug: list.slug,
                            changes: t('ui.count.changes', { count: list.changes.length }),
                          })}
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
                  ? t('admin.importChanges.applying')
                  : t('admin.importChanges.applyButton', {
                      changes: t('ui.count.changes', { count: totalChanges() }),
                      lists: t('ui.count.lists', { count: b().lists.length }),
                    })}
              </button>
            </>
          )}
        </Show>
      </div>
    </div>
  )
}
