import {
  type JSX,
  For,
  Match,
  Show,
  Switch,
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
} from 'solid-js'
import { StatusAlerts } from '../components/StatusAlerts'
import { LIST_TYPES, LIST_TYPE_DISPLAY, type ListType } from '../../../list/list-type'
import { useT, useTKey, useTSegments } from '../../../ui/i18n'
import { DECK_FORMAT_KEYS, getDeckFormatLabel } from '../../../list/deck-format'
import {
  CSV_FIELDS,
  CSV_FIELD_LABELS,
  FIELD_TO_KEY,
  formatColumnsSpec,
  guessColumns,
  guessHasHeader,
  isRequiredCsvField,
  parseCsv,
  validateMapping,
  type ColumnMapping,
  type CsvField,
  type CsvRow,
  type CsvRowFailure,
} from '../../../importers/csv'
import type { ImportCsvResponse } from '../../api/import-csv'
import type { ApiErrorResponse } from '../../../api/http'
import { PageHeading } from '../components/PageHeading'
import type { ParameterlessKey } from '../../../i18n/t'

type SourceMethod = 'upload' | 'text'

/**
 * What `POST /api/import-csv` answers with, either way. The status decides which
 * arm it is — `success` is a pure envelope flag, so a partially-failed import is
 * a 2xx {@link ImportCsvResponse} whose `failures` are the point.
 */
type ImportCsvResult = ImportCsvResponse | ApiErrorResponse

/** One tab of the source picker; `labelKey` is a {@link MessageKey}, resolved at render time. */
type MethodOption = { id: SourceMethod; labelKey: ParameterlessKey }

const METHODS: MethodOption[] = [
  { id: 'upload', labelKey: 'admin.import.upload' },
  { id: 'text', labelKey: 'admin.import.pasteText' },
]

type ImportMode = 'create' | 'append'

/** -1 means "this field has no column in the file". */
type ColumnSelections = Record<CsvField, number>

type ListSummary = { slug: string; name: string }

/** One entry in a column-mapping select; value is the stringified 0-based index. */
type ColumnOption = { value: string; label: string }

type ListEndpoint = { url: string; key: string }

const LIST_ENDPOINTS: Record<ListType, ListEndpoint> = {
  deck: { url: '/api/decks', key: 'decks' },
  collection: { url: '/api/collections', key: 'collections' },
  wanted: { url: '/api/wanted', key: 'wantedLists' },
}

function emptySelections(): ColumnSelections {
  return {
    name: -1,
    set: -1,
    'collector-number': -1,
    condition: -1,
    finish: -1,
    language: -1,
    section: -1,
    quantity: -1,
  }
}

function guessSelections(headerCells: string[] | null): ColumnSelections {
  const selections = emptySelections()
  if (!headerCells) return selections
  const guessed = guessColumns(headerCells)
  for (const field of CSV_FIELDS) {
    const index = guessed[FIELD_TO_KEY[field]]
    if (index !== undefined) selections[field] = index
  }
  return selections
}

async function fetchLists(listType: ListType): Promise<ListSummary[]> {
  const endpoint = LIST_ENDPOINTS[listType]
  const resp = await fetch(endpoint.url, { credentials: 'same-origin' })
  if (!resp.ok) return []
  const data = (await resp.json()) as Record<string, ListSummary[] | undefined>
  return data[endpoint.key] ?? []
}

export function ImportCsv(): JSX.Element {
  const t = useT()
  const tKey = useTKey()
  const tSegments = useTSegments()
  const [method, setMethod] = createSignal<SourceMethod>('upload')
  const [fileName, setFileName] = createSignal('')
  const [fileContent, setFileContent] = createSignal('')
  const [text, setText] = createSignal('')
  const [listType, setListType] = createSignal<ListType>('collection')
  const [mode, setMode] = createSignal<ImportMode>('create')
  const [overwrite, setOverwrite] = createSignal(false)
  const [name, setName] = createSignal('')
  const [targetSlug, setTargetSlug] = createSignal('')
  const [format, setFormat] = createSignal('commander')
  const [hasHeader, setHasHeader] = createSignal(true)
  const [selections, setSelections] = createSignal<ColumnSelections>(emptySelections())

  const [status, setStatus] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [failures, setFailures] = createSignal<CsvRowFailure[]>([])
  const [loading, setLoading] = createSignal(false)

  const content = createMemo((): string => (method() === 'upload' ? fileContent() : text()))

  const parsed = createMemo(() => {
    const value = content().trim()
    return value === '' ? null : parseCsv(value)
  })
  const parseError = createMemo((): string | null => {
    const result = parsed()
    return result && 'error' in result ? result.error : null
  })
  const rows = createMemo((): CsvRow[] => {
    const result = parsed()
    return result && 'rows' in result ? result.rows : []
  })

  // Re-guess the header flag and the column mapping whenever new CSV content
  // is loaded; manual adjustments are kept until the content itself changes.
  // Deferred so the initial empty state doesn't count as a content change.
  createEffect(
    on(
      rows,
      (currentRows) => {
        if (currentRows.length === 0) return
        const header = guessHasHeader(currentRows[0]!.cells)
        setHasHeader(header)
        setSelections(guessSelections(header ? currentRows[0]!.cells : null))
      },
      { defer: true },
    ),
  )

  // The outcome describes the CSV that was submitted, so new content retires it.
  // Otherwise a green "Imported 40 card(s)" (or a red failure list) stays on
  // screen above a file the user has just swapped in, describing the previous one.
  createEffect(
    on(
      content,
      () => {
        batch(() => {
          setStatus(null)
          setError(null)
          setFailures([])
        })
      },
      { defer: true },
    ),
  )

  const headerCells = createMemo((): string[] | null =>
    hasHeader() ? (rows()[0]?.cells ?? null) : null,
  )
  const sampleCells = createMemo(
    (): string[] => (hasHeader() ? rows()[1]?.cells : rows()[0]?.cells) ?? [],
  )
  const columnCount = createMemo((): number =>
    rows().reduce((max, row) => Math.max(max, row.cells.length), 0),
  )
  const dataRowCount = createMemo((): number =>
    hasHeader() ? Math.max(rows().length - 1, 0) : rows().length,
  )

  const visibleFields = createMemo((): CsvField[] =>
    CSV_FIELDS.filter((field) => field !== 'condition' || listType() !== 'wanted'),
  )

  const requiredFields = createMemo(
    (): ReadonlySet<CsvField> =>
      new Set(CSV_FIELDS.filter((field) => isRequiredCsvField(field, listType()))),
  )

  const mapping = createMemo((): Partial<ColumnMapping> => {
    const result: Partial<ColumnMapping> = {}
    for (const field of visibleFields()) {
      const index = selections()[field]
      if (index >= 0) result[FIELD_TO_KEY[field]] = index
    }
    return result
  })

  const mappingProblem = createMemo((): string | null => {
    if (rows().length === 0) return null
    const partial = mapping()
    if (partial.name === undefined) return t('admin.importCsv.chooseNameColumn')
    return validateMapping(partial as ColumnMapping, listType())
  })

  const [existingLists] = createResource(
    (): ListType | false => (mode() === 'append' ? listType() : false),
    fetchLists,
  )

  const canSubmit = createMemo((): boolean => {
    if (rows().length === 0 || parseError() !== null) return false
    if (dataRowCount() === 0 || mappingProblem() !== null) return false
    if (mode() === 'append') return targetSlug().trim() !== ''
    return name().trim() !== ''
  })

  const handleFileChange = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    if (!file) return
    setFileContent(await file.text())
    setFileName(file.name)
    if (name() === '') setName(file.name.replace(/\.[^.]+$/, ''))
  }

  const columnOptions = createMemo((): ColumnOption[] =>
    Array.from({ length: columnCount() }, (_, index) => {
      const header = headerCells()?.[index]
      const sample = sampleCells()[index]
      const base = header
        ? t('admin.importCsv.columnWithHeader', { index: index + 1, header })
        : t('admin.importCsv.column', { index: index + 1 })
      const label = sample ? t('admin.importCsv.columnSample', { label: base, sample }) : base
      return { value: String(index), label }
    }),
  )

  const handleImport = async (e: SubmitEvent) => {
    e.preventDefault()
    if (!canSubmit() || loading()) return
    setLoading(true)
    setStatus(null)
    setError(null)
    setFailures([])
    try {
      const requestMode = mode() === 'create' && overwrite() ? 'overwrite' : mode()
      const body = {
        listType: listType(),
        name: mode() === 'append' ? targetSlug() : name().trim(),
        mode: requestMode,
        format: listType() === 'deck' && mode() === 'create' ? format() : undefined,
        content: content(),
        columns: formatColumnsSpec(mapping() as ColumnMapping),
        hasHeader: hasHeader(),
      }
      const resp = await fetch('/api/import-csv', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      // `success` is now a pure envelope flag — a 2xx always carries it — so the
      // HTTP status is what says whether the request was accepted. The per-row
      // report is rendered either way; a partially-failed import is a success
      // whose failures are the point.
      const data = (await resp.json()) as ImportCsvResult
      if (!resp.ok) {
        setFailures([])
        setError(data.message || t('admin.importCsv.failed'))
        return
      }
      const imported = data as ImportCsvResponse
      setFailures(imported.failures)
      // An import that wrote nothing is not a success to banner in green, even
      // though the *request* succeeded: every row failed, and the message says
      // so. Anything that landed at least one copy reads as a status.
      if (imported.cardCount === 0 && imported.failedCount > 0) setError(imported.message)
      else setStatus(imported.message)
    } catch {
      setError(t('admin.importCsv.failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PageHeading page="import-csv" />
      <StatusAlerts status={status()} error={error()} />
      <Show when={failures().length > 0}>
        <div class="alert alert-error csv-failures">
          <p>{t('admin.importCsv.failuresLead', { count: failures().length })}</p>
          <ul>
            <For each={failures()}>
              {/* The offending row sits mid-sentence and renders as code, so
                  the message is drawn as segments. */}
              {(failure) => (
                <li>
                  <For
                    each={tSegments('admin.importCsv.failureRow', {
                      line: failure.lineNumber,
                      raw: failure.raw,
                      reason: failure.reason,
                    })}
                  >
                    {(segment) =>
                      segment.kind === 'param' && segment.name === 'raw' ? (
                        <code>{segment.value}</code>
                      ) : (
                        segment.value
                      )
                    }
                  </For>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      <form onSubmit={(e) => void handleImport(e)} class="form-container">
        <div class="segmented" role="group" aria-label={t('admin.importCsv.sourceLabel')}>
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
              <label class="form-label">{t('admin.importCsv.fileLabel')}</label>
              <div class="file-input-row">
                <label class="btn btn-secondary">
                  {t('admin.import.chooseFile')}
                  <input
                    type="file"
                    class="file-input-hidden"
                    accept=".csv,text/csv,text/plain"
                    onChange={(e) => void handleFileChange(e.currentTarget)}
                  />
                </label>
                <span class="file-input-name">{fileName() || t('admin.import.noFile')}</span>
              </div>
              <p class="form-hint form-hint-top">{t('admin.importCsv.fileHint')}</p>
            </div>
          </Match>
          <Match when={method() === 'text'}>
            <div>
              <label class="form-label">{t('admin.importCsv.textLabel')}</label>
              <textarea
                class="form-input form-textarea"
                value={text()}
                onInput={(e) => setText(e.currentTarget.value)}
                // i18n-exempt: a CSV interchange sample (dialect header + a real card).
                placeholder={'Name,Set,Collector Number,Quantity\nSol Ring,C19,221,1'}
              />
            </div>
          </Match>
        </Switch>

        <Show when={parseError()}>
          <div class="alert alert-error">
            {t('admin.importCsv.parseFailed', { reason: parseError() ?? '' })}
          </div>
        </Show>

        <Show when={rows().length > 0 && !parseError()}>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={hasHeader()}
              onChange={(e) => {
                setHasHeader(e.currentTarget.checked)
                setSelections(
                  guessSelections(e.currentTarget.checked ? (rows()[0]?.cells ?? null) : null),
                )
              }}
            />
            {t('admin.importCsv.hasHeader')}
          </label>

          <div>
            <label class="form-label">{t('admin.importCsv.mappingLabel')}</label>
            <div class="csv-mapping-grid">
              <For each={visibleFields()}>
                {(field) => (
                  <>
                    <span class="csv-mapping-label">
                      {CSV_FIELD_LABELS[field]}
                      <Show when={!requiredFields().has(field)}>
                        <span class="csv-mapping-optional"> {t('admin.importCsv.optional')}</span>
                      </Show>
                    </span>
                    <select
                      class="form-input"
                      data-field={field}
                      value={String(selections()[field])}
                      onChange={(e) =>
                        setSelections({
                          ...selections(),
                          [field]: Number.parseInt(e.currentTarget.value, 10),
                        })
                      }
                    >
                      <Show when={!requiredFields().has(field)}>
                        <option value="-1">{t('admin.importCsv.notInFile')}</option>
                      </Show>
                      <Show when={requiredFields().has(field) && selections()[field] === -1}>
                        <option value="-1">{t('admin.importCsv.selectColumn')}</option>
                      </Show>
                      <For each={columnOptions()}>
                        {(option) => <option value={option.value}>{option.label}</option>}
                      </For>
                    </select>
                  </>
                )}
              </For>
            </div>
            <Show when={mappingProblem()}>
              <p class="form-hint form-hint-top csv-mapping-problem">{mappingProblem()}</p>
            </Show>
            <p class="form-hint form-hint-top">
              {t('admin.importCsv.rowsHint', { count: dataRowCount() })}
            </p>
          </div>
        </Show>

        <div>
          <label class="form-label">{t('admin.importCsv.importIntoLabel')}</label>
          <select
            class="form-input csv-list-type"
            value={listType()}
            onChange={(e) => setListType(e.currentTarget.value as ListType)}
          >
            <For each={LIST_TYPES}>
              {(type) => (
                <option value={type}>
                  {LIST_TYPE_DISPLAY[type].icon} {tKey(LIST_TYPE_DISPLAY[type].label)}
                </option>
              )}
            </For>
          </select>
        </div>

        <div class="segmented" role="group" aria-label={t('admin.importCsv.modeLabel')}>
          <button
            type="button"
            class="segmented-option"
            data-active={mode() === 'create'}
            aria-pressed={mode() === 'create'}
            onClick={() => setMode('create')}
          >
            {t('admin.importCsv.modeCreate')}
          </button>
          <button
            type="button"
            class="segmented-option"
            data-active={mode() === 'append'}
            aria-pressed={mode() === 'append'}
            onClick={() => setMode('append')}
          >
            {t('admin.importCsv.modeAppend')}
          </button>
        </div>

        <Switch>
          <Match when={mode() === 'create'}>
            <div>
              <label class="form-label">{t('admin.importCsv.nameLabel')}</label>
              <input
                type="text"
                class="form-input"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder={t('admin.importCsv.namePlaceholder')}
              />
            </div>
            <Show when={listType() === 'deck'}>
              <div>
                <label class="form-label">{t('admin.importCsv.formatLabel')}</label>
                <select
                  class="form-input csv-format"
                  value={format()}
                  onChange={(e) => setFormat(e.currentTarget.value)}
                >
                  <For each={DECK_FORMAT_KEYS}>
                    {(key) => <option value={key}>{getDeckFormatLabel(key)}</option>}
                  </For>
                </select>
              </div>
            </Show>
            <label class="checkbox-label">
              <input
                type="checkbox"
                checked={overwrite()}
                onChange={(e) => setOverwrite(e.currentTarget.checked)}
              />
              {t('admin.importCsv.overwrite')}
            </label>
          </Match>
          <Match when={mode() === 'append'}>
            <div>
              <label class="form-label">{t('admin.importCsv.targetLabel')}</label>
              <select
                class="form-input csv-target"
                value={targetSlug()}
                onChange={(e) => setTargetSlug(e.currentTarget.value)}
              >
                <option value="">{t('admin.importCsv.selectList')}</option>
                <For each={existingLists() ?? []}>
                  {(list) => <option value={list.slug}>{list.name}</option>}
                </For>
              </select>
              <Show when={!existingLists.loading && (existingLists() ?? []).length === 0}>
                <p class="form-hint form-hint-top">
                  {t('admin.importCsv.noLists', { listType: listType() })}
                </p>
              </Show>
            </div>
          </Match>
        </Switch>

        <button type="submit" class="btn btn-primary" disabled={loading() || !canSubmit()}>
          {loading()
            ? t('admin.import.importing')
            : mode() === 'append'
              ? t('admin.importCsv.appendCards')
              : t('admin.importCsv.import')}
        </button>
      </form>
    </div>
  )
}
