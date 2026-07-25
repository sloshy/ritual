import {
  type JSX,
  createSignal,
  createEffect,
  createMemo,
  batch,
  onMount,
  Show,
  For,
} from 'solid-js'
import { NavLink } from '../components/NavLink'
import {
  DECK_FORMAT_KEYS,
  getDeckFormatLabel,
  parseDeckFormat,
  type DeckFormatKey,
} from '../../../deck-format'
import { listFileName } from '../../../list-file-name'
import { type ListType, LIST_TYPE_DISPLAY } from '../../../list-type'
import type { RitualConfig, SiteConfig } from '../../../ritual-config'
import { type SiteSelectionConfig, defaultSiteSelection } from '../../../site/list-selection'
import { fetchRitualConfig } from '../config-api'
import { StatusAlerts } from '../components/StatusAlerts'
import { useApiAction } from '../hooks/useApiAction'

type Category = 'decks' | 'collections' | 'wanted'
type ViewState = 'list' | 'create' | 'rename' | 'delete'
type ListItem = { slug: string; name: string }
type CreateBody = { name: string; format?: DeckFormatKey }
/** The `site` selection keys that hold an exclude list — never the include lists. */
type ExcludeKey = Extract<keyof SiteSelectionConfig, `exclude${string}`>

type CategoryMeta = {
  label: string
  singular: string
  icon: string
  listUrl: string
  listKey: 'decks' | 'collections' | 'wantedLists'
  /** The `site` selection key whose exclude list gates this category's visibility. */
  excludeKey: ExcludeKey
  /** Which Edit Lists tab edits this category's lists. */
  listType: ListType
  hasFormat: boolean
  createUrl: string
  itemUrl: (slug: string) => string
  renameUrl: (slug: string) => string
}

const CATEGORY_META: Record<Category, CategoryMeta> = {
  decks: {
    label: LIST_TYPE_DISPLAY.deck.label,
    singular: 'deck',
    icon: LIST_TYPE_DISPLAY.deck.icon,
    listUrl: '/api/decks',
    listKey: 'decks',
    excludeKey: 'excludeDecks',
    listType: 'deck',
    hasFormat: true,
    createUrl: '/api/deck/create',
    itemUrl: (slug) => `/api/deck/${slug}`,
    renameUrl: (slug) => `/api/deck/${slug}/rename`,
  },
  collections: {
    label: LIST_TYPE_DISPLAY.collection.label,
    singular: 'collection',
    icon: LIST_TYPE_DISPLAY.collection.icon,
    listUrl: '/api/collections',
    listKey: 'collections',
    excludeKey: 'excludeCollections',
    listType: 'collection',
    hasFormat: false,
    createUrl: '/api/collection/create',
    itemUrl: (slug) => `/api/collection/${slug}`,
    renameUrl: (slug) => `/api/collection/${slug}/rename`,
  },
  wanted: {
    label: LIST_TYPE_DISPLAY.wanted.label,
    singular: 'wanted list',
    icon: LIST_TYPE_DISPLAY.wanted.icon,
    listUrl: '/api/wanted',
    listKey: 'wantedLists',
    excludeKey: 'excludeWantedLists',
    listType: 'wanted',
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
  const [newFormat, setNewFormat] = createSignal<DeckFormatKey>('commander')
  const [renameName, setRenameName] = createSignal('')
  const [deleteConfirm, setDeleteConfirm] = createSignal('')
  const [config, setConfig] = createSignal<RitualConfig | null>(null)

  const { status, error, loading, run, setStatus, setError } = useApiAction()

  const meta = createMemo((): CategoryMeta => CATEGORY_META[category()])

  // The file each form would write, or null when the typed name has no characters
  // usable in one. Single source of truth for the preview, the submit button, and
  // the submit handlers, so the Enter key cannot bypass what the button blocks.
  const newFile = createMemo((): string | null => listFileName(newName()))
  const renameFile = createMemo((): string | null => listFileName(renameName()))

  // The exclude list gating the current category's public visibility. A list is
  // public unless its display name appears here; toggling visibility edits only
  // this list (never the include list).
  const excludeList = createMemo((): string[] => config()?.site?.[meta().excludeKey] ?? [])
  const isPublic = (item: ListItem): boolean => !excludeList().includes(item.name)

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

  const fetchConfig = async () => {
    const cfg = await fetchRitualConfig()
    // On failure the visibility toggles stay disabled until the config loads.
    if (cfg) setConfig(cfg)
  }

  // Flip a list's public visibility by editing only the category's exclude list:
  // hiding adds the display name, showing removes it. The full `site` object is
  // sent so the PUT (a top-level replace) preserves deployment + include settings.
  const toggleVisibility = async (item: ListItem) => {
    const cfg = config()
    if (!cfg) return
    const m = meta()
    const site: SiteConfig = cfg.site ?? defaultSiteSelection()
    const currentExclude = site[m.excludeKey]
    const makeHidden = isPublic(item)
    const nextExclude = makeHidden
      ? [...currentExclude, item.name]
      : currentExclude.filter((name) => name !== item.name)
    const nextSite: SiteConfig = { ...site, [m.excludeKey]: nextExclude }
    // Optimistically reflect the new state, reverting if the save fails.
    setConfig({ ...cfg, site: nextSite })
    const ok = await run(
      '/api/config',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: nextSite }),
      },
      `Failed to update ${m.singular} visibility`,
    )
    if (ok) {
      setStatus(
        `'${item.name}' is now ${makeHidden ? 'hidden from' : 'visible on'} the public site`,
      )
    } else {
      setConfig(cfg)
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

  onMount(() => {
    void fetchConfig()
  })

  const handleCreate = async () => {
    const m = meta()
    const trimmed = newName().trim()
    if (!trimmed || !newFile()) return
    const body: CreateBody = { name: trimmed }
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
    if (!trimmed || !renameFile() || trimmed === item.name) return
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

      <div class="list-type-tabs">
        <For each={CATEGORIES}>
          {(c) => (
            <button
              class="list-type-tab"
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
                  {(item) => {
                    const pub = () => isPublic(item)
                    return (
                      <div class="deck-list-item">
                        <div>
                          <span class="deck-name">{item.name}</span>
                          <span class="deck-slug">{item.slug}</span>
                        </div>
                        <div class="deck-list-actions">
                          <label
                            class="visibility-toggle"
                            title={`Show or hide this ${meta().singular} on the public site`}
                          >
                            <input
                              type="checkbox"
                              name="visibility"
                              checked={pub()}
                              disabled={loading() || !config()}
                              onChange={() => void toggleVisibility(item)}
                            />
                            <span class="visibility-toggle-track" aria-hidden="true" />
                            <span class="visibility-toggle-label">
                              {pub() ? 'Public' : 'Hidden'}
                            </span>
                          </label>
                          <NavLink
                            page="list-editor"
                            options={{ listType: meta().listType, slug: item.slug }}
                            class="btn btn-secondary btn-sm"
                          >
                            Edit
                          </NavLink>
                          <button class="btn btn-secondary btn-sm" onClick={() => openRename(item)}>
                            Rename
                          </button>
                          <button class="btn btn-danger btn-sm" onClick={() => openDelete(item)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    )
                  }}
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
                <Show
                  when={newFile()}
                  fallback={
                    <p class="form-hint form-hint-top text-danger">
                      This name has no characters that can be used in a file name.
                    </p>
                  }
                >
                  {(fileName) => (
                    <p class="form-hint form-hint-top">
                      File name: <code>{fileName()}</code>
                    </p>
                  )}
                </Show>
              </Show>
            </div>
            <Show when={meta().hasFormat}>
              <div>
                <label class="form-label">Format</label>
                <select
                  class="form-input"
                  value={newFormat()}
                  onChange={(e) =>
                    setNewFormat(parseDeckFormat(e.currentTarget.value) ?? 'commander')
                  }
                >
                  <For each={DECK_FORMAT_KEYS}>
                    {(key) => <option value={key}>{getDeckFormatLabel(key)}</option>}
                  </For>
                </select>
              </div>
            </Show>
            <div class="form-actions">
              <button
                class="btn btn-primary"
                onClick={() => void handleCreate()}
                disabled={loading() || !newFile()}
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
                    <Show
                      when={renameFile()}
                      fallback={
                        <p class="form-hint form-hint-top text-danger">
                          This name has no characters that can be used in a file name.
                        </p>
                      }
                    >
                      {(fileName) => (
                        <p class="form-hint form-hint-top">
                          New file name: <code>{fileName()}</code>
                        </p>
                      )}
                    </Show>
                  </Show>
                </div>
                <div class="form-actions">
                  <button
                    class="btn btn-primary"
                    onClick={() => void handleRename()}
                    disabled={loading() || !renameFile() || renameName() === item().name}
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
