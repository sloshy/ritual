import { createSignal } from 'solid-js'
import { useApiAction } from '../hooks/useApiAction'
import { StatusAlerts } from '../components/StatusAlerts'

export function ImportDeck() {
  const [source, setSource] = createSignal('')
  const [overwrite, setOverwrite] = createSignal(false)
  const { status, error, loading, run } = useApiAction()

  const handleImport = async (e: Event) => {
    e.preventDefault()
    if (!source().trim()) return
    const ok = await run(
      '/api/import-deck',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: source(), overwrite: overwrite() }),
      },
      'Failed to import deck',
    )
    if (ok) setSource('')
  }

  return (
    <div>
      <h2 class="section-heading">📥 Import Deck</h2>
      <StatusAlerts status={status()} error={error()} />
      <form onSubmit={handleImport} class="form-container">
        <div>
          <label class="form-label">Deck URL or File Path</label>
          <input
            type="text"
            class="form-input"
            value={source()}
            onInput={(e) => setSource(e.currentTarget.value)}
            placeholder="https://archidekt.com/decks/..."
          />
          <p class="form-hint form-hint-top">Supports Archidekt, Moxfield, and MTGGoldfish URLs</p>
        </div>
        <label class="checkbox-label">
          <input
            type="checkbox"
            checked={overwrite()}
            onChange={(e) => setOverwrite(e.currentTarget.checked)}
          />
          Overwrite existing deck if it exists
        </label>
        <button type="submit" class="btn btn-primary" disabled={loading() || !source().trim()}>
          {loading() ? 'Importing...' : 'Import Deck'}
        </button>
      </form>
    </div>
  )
}
