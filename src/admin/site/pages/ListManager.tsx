import { type JSX, createSignal, createEffect, createMemo, batch, Show, For } from 'solid-js'
import { StatusAlerts } from '../components/StatusAlerts'
import { useApiAction } from '../hooks/useApiAction'

type Category = 'decks' | 'collections' | 'wanted'
type ViewState = 'list' | 'create' | 'rename' | 'delete'
type ListItem = { slug: string; name: string }

type CategoryMeta = {
  label: string
  singular: string
  icon: string
  listUrl: string
  listKey: 'decks' | 'collections' | 'wantedLists'
  hasFormat: boolean
  createUrl: string
  itemUrl: (slug: string) => string
  renameUrl: (slug: string) => string
}

const CATEGORY_META: Record<Category, CategoryMeta> = {
  decks: {
    label: 'Decks',
    singular: 'deck',
    icon: '🃏',
    listUrl: '/api/decks',
    listKey: 'decks',
    hasFormat: true,
    createUrl: '/api/deck/create',
    itemUrl: (slug) => `/api/deck/${slug}`,
    renameUrl: (slug) => `/api/deck/${slug}/rename`,
  },
  collections: {
    label: 'Collections',
    singular: 'collection',
    icon: '📦',
    listUrl: '/api/collections',
    listKey: 'collections',
    hasFormat: false,
    createUrl: '/api/collection/create',
    itemUrl: (slug) => `/api/collection/${slug}`,
    renameUrl: (slug) => `/api/collection/${slug}/rename`,
  },
  wanted: {
    label: 'Wanted Lists',
    singular: 'wanted list',
    icon: '🎯',
    listUrl: '/api/wanted',
    listKey: 'wantedLists',
    hasFormat: false,
    createUrl: '/api/wanted/create',
    itemUrl: (slug) => `/api/wanted/${slug}`,
    renameUrl: (slug) => `/api/wanted/${slug}/rename`,
  },
}

const CATEGORIES: Category[] = ['decks', 'collections', 'wanted']

export function ListManager(): JSX.Element {
  const [category, setCategory] = createSignal<Category>('decks')
  const [items, setItems] = createSignal<ListItem[]>([])
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [view, setView] = createSignal<ViewState>('list')
  const [selected, setSelected] = createSignal<ListItem | null>(null)

  const [newName, setNewName] = createSignal('')
  const [newFormat, setNewFormat] = createSignal('commander')
  const [renameName, setRenameName] = createSignal('')
  const [deleteConfirm, setDeleteConfirm] = createSignal('')

  const { status, error, loading, run, setStatus, setError } = useApiAction()

  const meta = createMemo((): CategoryMeta => CATEGORY_META[category()])

  const fetchItems = async () => {
    const m = meta()
    setLoadError(null)
    try {
      const resp = await fetch(m.listUrl, { credentials: 'same-origin' })
      const data = (await resp.json()) as Record<string, ListItem[]>
      setItems(data[m.listKey] ?? [])
    } catch {
      setLoadError(`Failed to load ${m.label.toLowerCase()}`)
      setItems([])
    }
  }

  const resetForms = () => {
    batch(() => {
      setNewName('')
      setNewFormat('commander')
      setRenameName('')
      setDeleteConfirm('')
      setSelected(null)
      setError(null)
    })
  }

  createEffect(() => {
    category()
    setView('list')
    resetForms()
    void fetchItems()
  })

  const handleCreate = async () => {
    const m = meta()
    const trimmed = newName().trim()
    if (!trimmed) return
    const body: { name: string; format?: string } = { name: trimmed }
    if (m.hasFormat) body.format = newFormat()
    const ok = await run(
      m.createUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      `Failed to create ${m.singular}`,
    )
    if (ok) {
      setStatus(`Created ${m.singular} '${trimmed}'`)
      resetForms()
      setView('list')
      await fetchItems()
    }
  }

  const handleRename = async () => {
    const m = meta()
    const item = selected()
    if (!item) return
    const trimmed = renameName().trim()
    if (!trimmed || trimmed === item.name) return
    const ok = await run(
      m.renameUrl(item.slug),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: trimmed }),
      },
      `Failed to rename ${m.singular}`,
    )
    if (ok) {
      setStatus(`Renamed ${m.singular} to '${trimmed}'`)
      resetForms()
      setView('list')
      await fetchItems()
    }
  }

  const handleDelete = async () => {
    const m = meta()
    const item = selected()
    if (!item) return
    if (deleteConfirm() !== item.name) return
    const ok = await run(
      m.itemUrl(item.slug),
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: deleteConfirm() }),
      },
      `Failed to delete ${m.singular}`,
    )
    if (ok) {
      setStatus(`Deleted ${m.singular} '${item.name}'`)
      resetForms()
      setView('list')
      await fetchItems()
    }
  }

  const openCreate = () => {
    resetForms()
    setView('create')
  }

  const openRename = (item: ListItem) => {
    resetForms()
    setSelected(item)
    setRenameName(item.name)
    setView('rename')
  }

  const openDelete = (item: ListItem) => {
    resetForms()
    setSelected(item)
    setView('delete')
  }

  const cancel = () => {
    resetForms()
    setView('list')
  }

  return (
    <div>
      <h2 class="section-heading">🗂️ Manage Lists</h2>

      <div class="list-manager-tabs">
        <For each={CATEGORIES}>
          {(c) => (
            <button
              class="list-manager-tab"
              data-active={category() === c ? 'true' : undefined}
              onClick={() => setCategory(c)}
            >
              <span class="nav-icon">{CATEGORY_META[c].icon}</span>
              {CATEGORY_META[c].label}
            </button>
          )}
        </For>
      </div>

      <Show when={loadError()}>
        <p class="text-danger">{loadError()}</p>
      </Show>

      <Show when={!loadError()}>
        <StatusAlerts status={status()} error={error()} />

        <Show when={view() === 'list'}>
          <div>
            <div class="deck-manager-actions">
              <button class="btn btn-primary" onClick={openCreate}>
                + New {capitalize(meta().singular)}
              </button>
            </div>

            <Show
              when={items().length > 0}
              fallback={<p class="text-muted">No {meta().label.toLowerCase()} found.</p>}
            >
              <div class="deck-list">
                <For each={items()}>
                  {(item) => (
                    <div class="deck-list-item">
                      <div>
                        <span class="deck-name">{item.name}</span>
                        <span class="deck-slug">{item.slug}</span>
                      </div>
                      <div class="deck-list-actions">
                        <button class="btn btn-secondary btn-sm" onClick={() => openRename(item)}>
                          Rename
                        </button>
                        <button class="btn btn-danger btn-sm" onClick={() => openDelete(item)}>
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
            <h3 class="section-subheading">Create New {capitalize(meta().singular)}</h3>
            <div>
              <label class="form-label">{capitalize(meta().singular)} Name</label>
              <input
                type="text"
                class="form-input"
                placeholder={createPlaceholder(category())}
                value={newName()}
                onInput={(e) => setNewName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate()
                }}
                autofocus
              />
              <Show when={newName().trim()}>
                <p class="form-hint form-hint-top">
                  File name: <code>{slugify(newName())}.md</code>
                </p>
              </Show>
            </div>
            <Show when={meta().hasFormat}>
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
            </Show>
            <div class="form-actions">
              <button
                class="btn btn-primary"
                onClick={() => void handleCreate()}
                disabled={loading() || !newName().trim()}
              >
                {loading() ? 'Creating...' : `Create ${capitalize(meta().singular)}`}
              </button>
              <button class="btn btn-secondary" onClick={cancel} disabled={loading()}>
                Cancel
              </button>
            </div>
          </div>
        </Show>

        <Show when={view() === 'rename'}>
          <Show when={selected()}>
            {(item) => (
              <div class="form-container">
                <h3 class="section-subheading">Rename {capitalize(meta().singular)}</h3>
                <p class="text-muted">
                  Renaming: <strong>{item().name}</strong>
                </p>
                <div>
                  <label class="form-label">New Name</label>
                  <input
                    type="text"
                    class="form-input"
                    value={renameName()}
                    onInput={(e) => setRenameName(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRename()
                    }}
                    autofocus
                  />
                  <Show when={renameName().trim()}>
                    <p class="form-hint form-hint-top">
                      New file name: <code>{slugify(renameName())}.md</code>
                    </p>
                  </Show>
                </div>
                <div class="form-actions">
                  <button
                    class="btn btn-primary"
                    onClick={() => void handleRename()}
                    disabled={loading() || !renameName().trim() || renameName() === item().name}
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
        </Show>

        <Show when={view() === 'delete'}>
          <Show when={selected()}>
            {(item) => (
              <div class="form-container">
                <h3 class="section-subheading text-danger">Delete {capitalize(meta().singular)}</h3>
                <div class="delete-warning-box">
                  <p>
                    This will permanently delete <strong>{item().name}</strong>
                    {category() === 'decks'
                      ? ' and its changelog and primer'
                      : ' and its changelog'}
                    . This cannot be undone.
                  </p>
                </div>
                <div>
                  <label class="form-label">
                    Type <strong>{item().name}</strong> to confirm
                  </label>
                  <input
                    type="text"
                    class="form-input"
                    placeholder={item().name}
                    value={deleteConfirm()}
                    onInput={(e) => setDeleteConfirm(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && deleteConfirm() === item().name) void handleDelete()
                    }}
                    autofocus
                  />
                </div>
                <div class="form-actions">
                  <button
                    class="btn btn-delete"
                    onClick={() => void handleDelete()}
                    disabled={loading() || deleteConfirm() !== item().name}
                  >
                    {loading() ? 'Deleting...' : `Delete ${capitalize(meta().singular)}`}
                  </button>
                  <button class="btn btn-secondary" onClick={cancel} disabled={loading()}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  )
}

function createPlaceholder(category: Category): string {
  switch (category) {
    case 'decks':
      return 'e.g. My Commander Deck'
    case 'collections':
      return 'e.g. Main Collection'
    case 'wanted':
      return 'e.g. Holiday Wishlist'
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function slugify(name: string): string {
  return (
    name
      .trim()
      // eslint-disable-next-line no-control-regex -- null byte is intentional: strips filename-illegal chars.
      .replace(/[/\\:*?"<>|\x00]/g, '')
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .trim()
  )
}
