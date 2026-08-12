import { type JSX, For, Match, Show, Switch, createMemo, createSignal } from 'solid-js'
import { useT, useTKey, useTSegments } from '../../../ui/i18n'
import { apiMessage } from '../../api/result'
import type { ImportDeckRequest } from '../../api/import-deck'
import { useApiAction } from '../hooks/useApiAction'
import { StatusAlerts } from '../components/StatusAlerts'
import { PageHeading } from '../components/PageHeading'
import type { ParameterlessKey } from '../../../i18n/t'

type ImportMethod = 'url' | 'upload' | 'text'

/**
 * One tab of the source picker. `labelKey` is a {@link MessageKey}: the table is
 * built once at module load, so a rendered string would leave the tabs in the
 * boot-time language after a locale switch.
 */
type MethodOption = { id: ImportMethod; labelKey: ParameterlessKey }

const METHODS: MethodOption[] = [
  { id: 'url', labelKey: 'admin.importDeck.methodUrl' },
  { id: 'upload', labelKey: 'admin.import.upload' },
  { id: 'text', labelKey: 'admin.import.pasteText' },
]

export function ImportDeck(): JSX.Element {
  const t = useT()
  const tKey = useTKey()
  const tSegments = useTSegments()
  const [method, setMethod] = createSignal<ImportMethod>('url')
  const [url, setUrl] = createSignal('')
  const [text, setText] = createSignal('')
  const [name, setName] = createSignal('')
  const [fileName, setFileName] = createSignal('')
  const [fileContent, setFileContent] = createSignal('')
  const [overwrite, setOverwrite] = createSignal(false)
  // Default on: an import is a faithful copy unless the user opts out — the
  // page's standing form of the CLI's interactive printing prompt.
  const [syncPrintings, setSyncPrintings] = createSignal(true)
  const { status, error, loading, run } = useApiAction()

  const canSubmit = createMemo((): boolean => {
    switch (method()) {
      case 'url':
        return url().trim().length > 0
      case 'upload':
        return fileContent().trim().length > 0
      case 'text':
        return text().trim().length > 0
    }
  })

  const handleFileChange = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    if (!file) return
    setFileContent(await file.text())
    setFileName(file.name)
    setName(file.name.replace(/\.[^.]+$/, ''))
  }

  // Typed against the endpoint's own contract: `syncPrintings` is required in
  // url mode and refused in text mode, and the discriminated union makes
  // getting that wrong a compile error rather than a 400 at runtime.
  const importRequest = (): ImportDeckRequest =>
    method() === 'url'
      ? {
          mode: 'url',
          url: url().trim(),
          overwrite: overwrite(),
          syncPrintings: syncPrintings(),
        }
      : {
          mode: 'text',
          content: method() === 'upload' ? fileContent() : text(),
          name: name().trim() || undefined,
          overwrite: overwrite(),
        }

  const handleImport = async (e: SubmitEvent) => {
    e.preventDefault()
    if (!canSubmit()) return
    const ok = await run(
      '/api/import-deck',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importRequest()),
      },
      apiMessage('admin.importDeck.failed'),
    )
    if (ok) {
      setUrl('')
      setText('')
      setName('')
      setFileName('')
      setFileContent('')
    }
  }

  return (
    <div>
      <PageHeading page="import-deck" />
      <StatusAlerts status={status()} error={error()} />
      <form onSubmit={(e) => void handleImport(e)} class="form-container">
        <div class="segmented" role="group" aria-label={t('admin.importDeck.methodLabel')}>
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
          <Match when={method() === 'url'}>
            <div>
              <label class="form-label">{t('admin.importDeck.urlLabel')}</label>
              <input
                type="text"
                class="form-input"
                value={url()}
                onInput={(e) => setUrl(e.currentTarget.value)}
                // i18n-exempt: an example URL of a third-party site, not prose.
                placeholder="https://archidekt.com/decks/..."
              />
              <p class="form-hint form-hint-top">{t('admin.importDeck.urlHint')}</p>
            </div>
          </Match>

          <Match when={method() === 'upload'}>
            <div>
              <label class="form-label">{t('admin.importDeck.fileLabel')}</label>
              <div class="file-input-row">
                <label class="btn btn-secondary">
                  {t('admin.import.chooseFile')}
                  <input
                    type="file"
                    class="file-input-hidden"
                    accept=".md,.txt,.text,text/plain,text/markdown"
                    onChange={(e) => void handleFileChange(e.currentTarget)}
                  />
                </label>
                <span class="file-input-name">{fileName() || t('admin.import.noFile')}</span>
              </div>
              <p class="form-hint form-hint-top">{t('admin.importDeck.fileHint')}</p>
            </div>
          </Match>

          <Match when={method() === 'text'}>
            <div>
              <label class="form-label">{t('admin.importDeck.textLabel')}</label>
              <textarea
                class="form-input form-textarea"
                value={text()}
                onInput={(e) => setText(e.currentTarget.value)}
                // i18n-exempt: decklist syntax — real card names and the English-by-contract `Sideboard`.
                placeholder={'4 Lightning Bolt\n1 Sol Ring\n\n## Sideboard\n2 Pyroblast'}
              />
              {/* Both code samples sit mid-sentence, so the hint renders as
                  segments and each parameter takes the <code> markup. */}
              <p class="form-hint form-hint-top">
                <For
                  each={tSegments('admin.importDeck.textHint', {
                    syntax: t('admin.importDeck.qtyName'),
                    heading: t('admin.importDeck.headingSyntax'),
                  })}
                >
                  {(segment) =>
                    segment.kind === 'param' ? <code>{segment.value}</code> : segment.value
                  }
                </For>
              </p>
            </div>
          </Match>
        </Switch>

        <Show when={method() !== 'url'}>
          <div>
            <label class="form-label">{t('admin.importDeck.nameLabel')}</label>
            <input
              type="text"
              class="form-input"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder={t('admin.importDeck.namePlaceholder')}
            />
            <p class="form-hint form-hint-top">{t('admin.importDeck.nameHint')}</p>
          </div>
        </Show>

        {/* URL imports only: pasted text and uploaded files state their own printings. */}
        <Show when={method() === 'url'}>
          <label class="checkbox-label import-sync-printings">
            <input
              type="checkbox"
              checked={syncPrintings()}
              onChange={(e) => setSyncPrintings(e.currentTarget.checked)}
            />
            {t('admin.importDeck.syncPrintings')}
          </label>
        </Show>

        <label class="checkbox-label">
          <input
            type="checkbox"
            checked={overwrite()}
            onChange={(e) => setOverwrite(e.currentTarget.checked)}
          />
          {t('admin.importDeck.overwrite')}
        </label>
        <button type="submit" class="btn btn-primary" disabled={loading() || !canSubmit()}>
          {loading() ? t('admin.import.importing') : t('admin.importDeck.import')}
        </button>
      </form>
    </div>
  )
}
