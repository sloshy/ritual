import { useState, useCallback } from 'preact/hooks'
import { useApiAction } from '../hooks/useApiAction'
import { StatusAlerts } from '../components/StatusAlerts'

export function ImportDeck() {
  const [source, setSource] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const { status, error, loading, run } = useApiAction()

  const handleImport = useCallback(
    async (e: Event) => {
      e.preventDefault()
      if (!source.trim()) return
      const ok = await run(
        '/api/import-deck',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, overwrite }),
        },
        'Failed to import deck',
      )
      if (ok) setSource('')
    },
    [source, overwrite, run],
  )

  return (
    <div>
      <h2 class="section-heading">📥 Import Deck</h2>
      <StatusAlerts status={status} error={error} />
      <form onSubmit={handleImport} class="space-y-4 max-w-lg">
        <div>
          <label class="form-label">Deck URL or File Path</label>
          <input
            type="text"
            class="form-input"
            value={source}
            onInput={(e) => setSource(e.currentTarget.value)}
            placeholder="https://archidekt.com/decks/..."
          />
          <p class="form-hint mt-1">Supports Archidekt, Moxfield, and MTGGoldfish URLs</p>
        </div>
        <label class="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.currentTarget.checked)}
            class="rounded bg-gray-700 border-gray-600"
          />
          Overwrite existing deck if it exists
        </label>
        <button type="submit" class="btn btn-primary" disabled={loading || !source.trim()}>
          {loading ? 'Importing...' : 'Import Deck'}
        </button>
      </form>
    </div>
  )
}
