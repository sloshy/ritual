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
} from '../../../list/deck-format'
import { listFileName } from '../../../list/list-file-name'
import { type ListType, LIST_TYPE_DISPLAY } from '../../../list/list-type'
import { useT, useTKey, useTSegments } from '../../../ui/i18n'
import { apiMessage } from '../../api/result'
import type { RitualConfig, SiteConfig } from '../../../config/ritual-config'
import { type SiteSelectionConfig, defaultSiteSelection } from '../../../config/list-selection'
import { fetchRitualConfig } from '../config-api'
import { StatusAlerts } from '../components/StatusAlerts'
import { useApiAction } from '../hooks/useApiAction'
import { PageHeading } from '../components/PageHeading'
import type { ParameterlessKey } from '../../../i18n/t'

type Category = 'decks' | 'collections' | 'wanted'
type ViewState = 'list' | 'create' | 'rename' | 'delete'
type ListItem = { slug: string; name: string }
type CreateBody = { name: string; format?: DeckFormatKey }
/** The `site` selection keys that hold an exclude list — never the include lists. */
type ExcludeKey = Extract<keyof SiteSelectionConfig, `exclude${string}`>

type CategoryMeta = {
  /**
   * The category's plural name as a {@link MessageKey}, resolved at render time
   * so it follows the locale. The table below is built once at module load.
   */
  labelKey: ParameterlessKey
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
    labelKey: LIST_TYPE_DISPLAY.deck.label,
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
    labelKey: LIST_TYPE_DISPLAY.collection.label,
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
    labelKey: LIST_TYPE_DISPLAY.wanted.label,
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
  const t = useT()
  const tKey = useTKey()
  const tSegments = useTSegments()
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
  /**
   * The list type the current tab edits — the `$select` branch every message on
   * this page keys off. Verb + capitalized noun concatenation ("Create New " +
   * "Deck") survives neither case nor gender, so each phrase is a whole message
   * per list type instead (plan §7.3).
   */
  const listType = createMemo((): ListType => meta().listType)

  // Three sentences that carry markup around one parameter. Rendered as segments
  // so the marked-up word can sit anywhere in the sentence — a `prefix`/`suffix`
  // pair would pin it to the middle of the English word order.
  const codeFileName = (
    key: 'admin.list.fileNameHint' | 'admin.list.newFileNameHint',
    file: string,
  ) => (
    <For each={tSegments(key, { file })}>
      {(segment) => (segment.kind === 'param' ? <code>{segment.value}</code> : segment.value)}
    </For>
  )
  const fileNameHint = (file: string) => codeFileName('admin.list.fileNameHint', file)
  const newFileNameHint = (file: string) => codeFileName('admin.list.newFileNameHint', file)

  const boldName = (
    key: 'admin.list.renamingWhich' | 'admin.list.deleteConfirmLabel',
    name: string,
  ) => (
    <For each={tSegments(key, { name })}>
      {(segment) => (segment.kind === 'param' ? <strong>{segment.value}</strong> : segment.value)}
    </For>
  )

  const deleteWarning = (name: string) => (
    <For each={tSegments('admin.list.deleteWarning', { listType: listType(), name })}>
      {(segment) =>
        segment.kind === 'param' && segment.name === 'name' ? (
          <strong>{segment.value}</strong>
        ) : (
          segment.value
        )
      }
    </For>
  )

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
      setLoadError(t('admin.list.loadFailed', { listType: m.listType }))
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
      apiMessage('admin.list.visibilityFailed', { listType: m.listType }),
    )
    if (ok) {
      setStatus(
        makeHidden
          ? apiMessage('admin.list.nowHidden', { name: item.name })
          : apiMessage('admin.list.nowVisible', { name: item.name }),
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
      apiMessage('admin.list.createFailed', { listType: m.listType }),
    )
    if (ok) {
      // The API says exactly this after a create; reusing its key keeps the two
      // paths from drifting into two translations of one sentence.
      setStatus(apiMessage('admin.api.list.created', { listType: m.listType, name: trimmed }))
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
      apiMessage('admin.list.renameFailed', { listType: m.listType }),
    )
    if (ok) {
      setStatus(apiMessage('admin.api.list.renamed', { listType: m.listType, name: trimmed }))
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
      apiMessage('admin.list.deleteFailed', { listType: m.listType }),
    )
    if (ok) {
      setStatus(apiMessage('admin.api.list.deleted', { listType: m.listType, name: item.name }))
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
      <PageHeading page="list-manager" />

      <div class="list-type-tabs">
        <For each={CATEGORIES}>
          {(c) => (
            <button
              class="list-type-tab"
              data-active={category() === c ? 'true' : undefined}
              onClick={() => setCategory(c)}
            >
              <span class="nav-icon">{CATEGORY_META[c].icon}</span>
              {tKey(CATEGORY_META[c].labelKey)}
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
                {t('admin.list.newButton', { listType: listType() })}
              </button>
            </div>

            <Show
              when={items().length > 0}
              fallback={<p class="text-muted">{t('admin.list.empty', { listType: listType() })}</p>}
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
                            title={t('admin.list.visibilityTitle', { listType: listType() })}
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
                              {pub() ? t('admin.list.public') : t('admin.list.hidden')}
                            </span>
                          </label>
                          <NavLink
                            page="list-editor"
                            options={{ listType: meta().listType, slug: item.slug }}
                            class="btn btn-secondary btn-sm"
                          >
                            {t('admin.list.edit')}
                          </NavLink>
                          <button class="btn btn-secondary btn-sm" onClick={() => openRename(item)}>
                            {t('admin.list.rename')}
                          </button>
                          <button class="btn btn-danger btn-sm" onClick={() => openDelete(item)}>
                            {t('admin.list.delete')}
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
            <h3 class="section-subheading">
              {t('admin.list.createTitle', { listType: listType() })}
            </h3>
            <div>
              <label class="form-label">
                {t('admin.list.nameLabel', { listType: listType() })}
              </label>
              <input
                type="text"
                class="form-input"
                placeholder={t('admin.list.namePlaceholder', { listType: listType() })}
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
                      {t('admin.list.unusableName')}
                    </p>
                  }
                >
                  {(fileName) => <p class="form-hint form-hint-top">{fileNameHint(fileName())}</p>}
                </Show>
              </Show>
            </div>
            <Show when={meta().hasFormat}>
              <div>
                <label class="form-label">{t('admin.list.formatLabel')}</label>
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
                {loading()
                  ? t('admin.list.creating')
                  : t('admin.list.createButton', { listType: listType() })}
              </button>
              <button class="btn btn-secondary" onClick={cancel} disabled={loading()}>
                {t('ui.dialog.cancel')}
              </button>
            </div>
          </div>
        </Show>

        <Show when={view() === 'rename'}>
          <Show when={selected()}>
            {(item) => (
              <div class="form-container">
                <h3 class="section-subheading">
                  {t('admin.list.renameTitle', { listType: listType() })}
                </h3>
                <p class="text-muted">{boldName('admin.list.renamingWhich', item().name)}</p>
                <div>
                  <label class="form-label">{t('admin.list.newNameLabel')}</label>
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
                          {t('admin.list.unusableName')}
                        </p>
                      }
                    >
                      {(fileName) => (
                        <p class="form-hint form-hint-top">{newFileNameHint(fileName())}</p>
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
                    {loading() ? t('admin.list.renaming') : t('admin.list.rename')}
                  </button>
                  <button class="btn btn-secondary" onClick={cancel} disabled={loading()}>
                    {t('ui.dialog.cancel')}
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
                <h3 class="section-subheading text-danger">
                  {t('admin.list.deleteTitle', { listType: listType() })}
                </h3>
                <div class="delete-warning-box">
                  <p>{deleteWarning(item().name)}</p>
                </div>
                <div>
                  <label class="form-label">
                    {boldName('admin.list.deleteConfirmLabel', item().name)}
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
                    {loading()
                      ? t('admin.list.deleting')
                      : t('admin.list.deleteButton', { listType: listType() })}
                  </button>
                  <button class="btn btn-secondary" onClick={cancel} disabled={loading()}>
                    {t('ui.dialog.cancel')}
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
