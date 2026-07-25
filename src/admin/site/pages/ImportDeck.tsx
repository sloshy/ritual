import { type JSX, For, Match, Show, Switch, createMemo, createSignal } from 'solid-js'
import { useApiAction } from '../hooks/useApiAction'
import { StatusAlerts } from '../components/StatusAlerts'
import { PageHeading } from '../components/PageHeading'

type ImportMethod = 'url' | 'upload' | 'text'

type MethodOption = { id: ImportMethod; label: string }

const METHODS: MethodOption[] = [
  { id: 'url', label: 'URL' },
  { id: 'upload', label: 'Upload File' },
  { id: 'text', label: 'Paste Text' },
]

export function ImportDeck(): JSX.Element {
  const [method, setMethod] = createSignal<ImportMethod>('url')
  const [url, setUrl] = createSignal('')
  const [text, setText] = createSignal('')
  const [name, setName] = createSignal('')
  const [fileName, setFileName] = createSignal('')
  const [fileContent, setFileContent] = createSignal('')
  const [overwrite, setOverwrite] = createSignal(false)
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

  const requestBody = (): string => {
    if (method() === 'url') {
      return JSON.stringify({ mode: 'url', url: url().trim(), overwrite: overwrite() })
    }
    const content = method() === 'upload' ? fileContent() : text()
    return JSON.stringify({
      mode: 'text',
      content,
      name: name().trim() || undefined,
      overwrite: overwrite(),
    })
  }

  const handleImport = async (e: SubmitEvent) => {
    e.preventDefault()
    if (!canSubmit()) return
    const ok = await run(
      '/api/import-deck',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody(),
      },
      'Failed to import deck',
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
        <div class="segmented" role="group" aria-label="Import method">
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
          <Match when={method() === 'url'}>
            <div>
              <label class="form-label">Deck URL</label>
              <input
                type="text"
                class="form-input"
                value={url()}
                onInput={(e) => setUrl(e.currentTarget.value)}
                placeholder="https://archidekt.com/decks/..."
              />
              <p class="form-hint form-hint-top">
                Supports Archidekt, Moxfield, and MTGGoldfish URLs
              </p>
            </div>
          </Match>

          <Match when={method() === 'upload'}>
            <div>
              <label class="form-label">Deck File</label>
              <div class="file-input-row">
                <label class="btn btn-secondary">
                  Choose File
                  <input
                    type="file"
                    class="file-input-hidden"
                    accept=".md,.txt,.text,text/plain,text/markdown"
                    onChange={(e) => void handleFileChange(e.currentTarget)}
                  />
                </label>
                <span class="file-input-name">{fileName() || 'No file selected'}</span>
              </div>
              <p class="form-hint form-hint-top">
                A decklist or exported deck file (markdown or plain text)
              </p>
            </div>
          </Match>

          <Match when={method() === 'text'}>
            <div>
              <label class="form-label">Decklist Text</label>
              <textarea
                class="form-input form-textarea"
                value={text()}
                onInput={(e) => setText(e.currentTarget.value)}
                placeholder={'4 Lightning Bolt\n1 Sol Ring\n\n## Sideboard\n2 Pyroblast'}
              />
              <p class="form-hint form-hint-top">
                One card per line as <code>QTY Name</code>. Use <code>## Heading</code> lines to
                start new sections.
              </p>
            </div>
          </Match>
        </Switch>

        <Show when={method() !== 'url'}>
          <div>
            <label class="form-label">Deck Name</label>
            <input
              type="text"
              class="form-input"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="Imported Deck"
            />
            <p class="form-hint form-hint-top">Used unless the text defines its own name.</p>
          </div>
        </Show>

        <label class="checkbox-label">
          <input
            type="checkbox"
            checked={overwrite()}
            onChange={(e) => setOverwrite(e.currentTarget.checked)}
          />
          Overwrite existing deck if it exists
        </label>
        <button type="submit" class="btn btn-primary" disabled={loading() || !canSubmit()}>
          {loading() ? 'Importing...' : 'Import Deck'}
        </button>
      </form>
    </div>
  )
}
