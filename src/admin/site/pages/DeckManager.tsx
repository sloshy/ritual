import { createSignal, onMount, Show, For } from 'solid-js'
import { StatusAlerts } from '../components/StatusAlerts'
import { useApiAction } from '../hooks/useApiAction'

type DeckListItem = { slug: string; name: string }

type ViewState = 'list' | 'create' | 'rename' | 'delete'

export function DeckManager() {
  const [decks, setDecks] = createSignal<DeckListItem[]>([])
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [view, setView] = createSignal<ViewState>('list')
  const [selectedDeck, setSelectedDeck] = createSignal<DeckListItem | null>(null)

  // Create form state
  const [newName, setNewName] = createSignal('')
  const [newFormat, setNewFormat] = createSignal('commander')

  // Rename form state
  const [renameName, setRenameName] = createSignal('')

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = createSignal('')

  const { status, error, loading, run, setStatus, setError } = useApiAction()

  const fetchDecks = async () => {
    try {
      const resp = await fetch('/api/decks', { credentials: 'same-origin' })
      const data = (await resp.json()) as { decks: DeckListItem[] }
      setDecks(data.decks ?? [])
    } catch {
      setLoadError('Failed to load decks')
    }
  }

  onMount(() => {
    fetchDecks()
  })

  const handleCreate = async () => {
    const ok = await run(
      '/api/deck/create',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName(), format: newFormat() }),
      },
      'Failed to create deck',
    )
    if (ok) {
      setStatus(`Created deck '${newName()}'`)
      setNewName('')
      setNewFormat('commander')
      setView('list')
      await fetchDecks()
    }
  }

  const handleRename = async () => {
    const deck = selectedDeck()
    if (!deck) return
    const ok = await run(
      `/api/deck/${deck.slug}/rename`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: renameName() }),
      },
      'Failed to rename deck',
    )
    if (ok) {
      setStatus(`Renamed deck to '${renameName()}'`)
      setRenameName('')
      setSelectedDeck(null)
      setView('list')
      await fetchDecks()
    }
  }

  const handleDelete = async () => {
    const deck = selectedDeck()
    if (!deck) return
    const ok = await run(
      `/api/deck/${deck.slug}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: deleteConfirm() }),
      },
      'Failed to delete deck',
    )
    if (ok) {
      setStatus(`Deleted deck '${deck.name}'`)
      setDeleteConfirm('')
      setSelectedDeck(null)
      setView('list')
      await fetchDecks()
    }
  }

  const openRename = (deck: DeckListItem) => {
    setSelectedDeck(deck)
    setRenameName(deck.name)
    setError(null)
    setView('rename')
  }

  const openDelete = (deck: DeckListItem) => {
    setSelectedDeck(deck)
    setDeleteConfirm('')
    setError(null)
    setView('delete')
  }

  const cancel = () => {
    setView('list')
    setSelectedDeck(null)
    setNewName('')
    setNewFormat('commander')
    setRenameName('')
    setDeleteConfirm('')
    setError(null)
  }

  return (
    <div>
      <h2 class="section-heading">🗂️ Deck Manager</h2>
      <Show when={loadError()}>
        <p class="text-danger">{loadError()}</p>
      </Show>
      <Show when={!loadError()}>
        <StatusAlerts status={status()} error={error()} />

        <Show when={view() === 'list'}>
          <div>
            <div class="deck-manager-actions">
              <button
                class="btn btn-primary"
                onClick={() => {
                  setError(null)
                  setView('create')
                }}
              >
                + New Deck
              </button>
            </div>

            <Show when={decks().length > 0} fallback={<p class="text-muted">No decks found.</p>}>
              <div class="deck-list">
                <For each={decks()}>
                  {(deck) => (
                    <div class="deck-list-item">
                      <div>
                        <span class="deck-name">{deck.name}</span>
                        <span class="deck-slug">{deck.slug}</span>
                      </div>
                      <div class="deck-list-actions">
                        <button class="btn btn-secondary btn-sm" onClick={() => openRename(deck)}>
                          Rename
                        </button>
                        <button class="btn btn-danger btn-sm" onClick={() => openDelete(deck)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={view() === 'create'}>
          <div class="form-container">
            <h3 class="section-subheading">Create New Deck</h3>
            <div>
              <label class="form-label">Deck Name</label>
              <input
                type="text"
                class="form-input"
                placeholder="e.g. My Commander Deck"
                value={newName()}
                onInput={(e) => setNewName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                }}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autofocus
              />
              <Show when={newName().trim()}>
                <p class="form-hint form-hint-top">
                  Slug: <code>{slugify(newName())}</code>
                </p>
              </Show>
            </div>
            <div>
              <label class="form-label">Format</label>
              <select
                class="form-input"
                value={newFormat()}
                onChange={(e) => setNewFormat(e.currentTarget.value)}
              >
                <option value="commander">Commander</option>
                <option value="standard">Standard</option>
                <option value="pioneer">Pioneer</option>
                <option value="modern">Modern</option>
                <option value="legacy">Legacy</option>
                <option value="vintage">Vintage</option>
                <option value="pauper">Pauper</option>
                <option value="draft">Draft</option>
                <option value="cube">Cube</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div class="form-actions">
              <button
                class="btn btn-primary"
                onClick={handleCreate}
                disabled={loading() || !newName().trim()}
              >
                {loading() ? 'Creating...' : 'Create Deck'}
              </button>
              <button class="btn btn-secondary" onClick={cancel} disabled={loading()}>
                Cancel
              </button>
            </div>
          </div>
        </Show>

        <Show when={view() === 'rename' && selectedDeck()}>
          {(deck) => (
            <div class="form-container">
              <h3 class="section-subheading">Rename Deck</h3>
              <p class="text-muted">
                Renaming: <strong>{deck().name}</strong>
              </p>
              <div>
                <label class="form-label">New Name</label>
                <input
                  type="text"
                  class="form-input"
                  value={renameName()}
                  onInput={(e) => setRenameName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename()
                  }}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autofocus
                />
                <Show when={renameName().trim()}>
                  <p class="form-hint form-hint-top">
                    New slug: <code>{slugify(renameName())}</code>
                  </p>
                </Show>
              </div>
              <div class="form-actions">
                <button
                  class="btn btn-primary"
                  onClick={handleRename}
                  disabled={loading() || !renameName().trim() || renameName() === deck().name}
                >
                  {loading() ? 'Renaming...' : 'Rename'}
                </button>
                <button class="btn btn-secondary" onClick={cancel} disabled={loading()}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Show>

        <Show when={view() === 'delete' && selectedDeck()}>
          {(deck) => (
            <div class="form-container">
              <h3 class="section-subheading text-danger">Delete Deck</h3>
              <div class="delete-warning-box">
                <p>
                  This will permanently delete <strong>{deck().name}</strong> and its changelog.
                  This cannot be undone.
                </p>
              </div>
              <div>
                <label class="form-label">
                  Type <strong>{deck().name}</strong> to confirm
                </label>
                <input
                  type="text"
                  class="form-input"
                  placeholder={deck().name}
                  value={deleteConfirm()}
                  onInput={(e) => setDeleteConfirm(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && deleteConfirm() === deck().name) handleDelete()
                  }}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autofocus
                />
              </div>
              <div class="form-actions">
                <button
                  class="btn btn-delete"
                  onClick={handleDelete}
                  disabled={loading() || deleteConfirm() !== deck().name}
                >
                  {loading() ? 'Deleting...' : 'Delete Deck'}
                </button>
                <button class="btn btn-secondary" onClick={cancel} disabled={loading()}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Show>
      </Show>
    </div>
  )
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}
