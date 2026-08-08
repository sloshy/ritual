import type { Component, Accessor } from 'solid-js'
import { createSignal, createMemo, createEffect, on, onMount, onCleanup, For, Show } from 'solid-js'
import type {
  DeckSummary,
  CollectionSummary,
  WantedListSummary,
  DeckDetail,
  CollectionDetail,
  WantedListDetail,
} from './data-types'
import type { ScryfallCard } from '../types'
import type { PriceCurrency } from '../price-currency'
import { formatPriceWithMissing } from '../price-currency'
import { resolveCardThumbnailUrl } from './image-sources'
import { scoreMatch } from './quick-switch-search'
import { fetchJson } from './useFetchJson'
import { detailUrl } from './api-base'
import { getSummaryMissingPriceCount, getSummaryTotalPrice } from './utils'
import { getDeckCountLabel } from '../deck-format'
import { listHref } from './combined-list'
import type { MessageKey } from '../i18n/messages/en'
import { useI18n } from '../ui/i18n'
import type { TranslateFn } from '../i18n/t'
import {
  cardPrintingKey,
  formatPrintingLabel,
  lookupPrintingCard,
  printingKey,
} from '../printing-key'
import { hasSpecificPrinting } from '../card-printing'
import type { CardLanguage } from '../card-language'

/**
 * Re-case a stored `printingKey` for display. Uppercasing the whole key would
 * also uppercase the collector number, which no other surface does.
 */
function formatPrintingKeyLabel(key: string): string {
  const colon = key.indexOf(':')
  if (colon < 0) return key.toUpperCase()
  return formatPrintingLabel(key.slice(0, colon), key.slice(colon + 1))
}

type ListKind = 'deck' | 'collection' | 'wanted'

type ListEntry = {
  kind: 'list'
  listKind: ListKind
  href: string
  image: string
  name: string
  subtitle?: string
  label: string
  labelSuffix?: string
  total: number
  missing: number
}

type CommanderEntry = {
  kind: 'commander'
  href: string
  image: string
  commanderName: string
  deckName: string
}

type CardEntry = {
  kind: 'card'
  href: string
  image: string
  cardName: string
  parentKind: ListKind
  parentName: string
}

type PrintingEntry = {
  kind: 'printing'
  href: string
  image: string
  setCollectorDisplay: string
  cardName?: string
  parentKind: ListKind
  parentName: string
}

type QuickSwitchEntry = ListEntry | CommanderEntry | CardEntry | PrintingEntry

type Scored<T> = { entry: T; score: number }

type DetailPayload = DeckDetail | CollectionDetail | WantedListDetail

// A single owned/wanted/deck card line, normalized across list kinds.
type ListCardRef = {
  name: string
  set?: string
  collectorNumber?: string
  /** The line's language token, when present, so a `[ja]` line resolves its `@ja` card object. */
  language?: CardLanguage
}

type CardCandidate = {
  cardName: string
  setCollectorKey: string | null
  card: ScryfallCard | null
}

type LoadedDetail = {
  kind: ListKind
  slug: string
  listName: string
  candidates: CardCandidate[]
}

function collectCardRefs(data: DetailPayload): ListCardRef[] {
  if ('deck' in data) {
    const refs: ListCardRef[] = []
    for (const section of data.deck.sections) {
      for (const c of section.cards) {
        refs.push({
          name: c.name,
          set: c.set,
          collectorNumber: c.collectorNumber,
          language: c.language,
        })
      }
    }
    return refs
  }
  return data.entries.map((e) => ({
    name: e.name,
    set: e.set,
    collectorNumber: e.collectorNumber,
    language: e.language,
  }))
}

// The set:collector key a card line declares, if any — the key the `cards` map
// is built under, so it must be `printingKey` exactly.
function refPrintingKey(ref: ListCardRef): string | null {
  return hasSpecificPrinting(ref) ? printingKey(ref.set, ref.collectorNumber) : null
}

// Build search candidates from the list's actual card lines (owned/wanted/deck
// cards), NOT the raw `cards` lookup map. That map also holds changelog-only
// entries — keyed by the name of a card that was added then later removed — and
// those must never surface in search. Each distinct printing yields one
// candidate; duplicate lines of the same printing collapse by resolved card id
// (or by printing/name key when the card is unresolved).
function buildCandidates(data: DetailPayload): CardCandidate[] {
  const cards = data.cards
  const seen = new Set<string>()
  const out: CardCandidate[] = []
  for (const ref of collectCardRefs(data)) {
    // Collections/wanted lists key their card map by set:collector; decks key by
    // name. `lookupPrintingCard` owns the rule, including the explicit-null case.
    const declaredKey = refPrintingKey(ref)
    const card = lookupPrintingCard(cards, ref)
    // Label the printing by the resolved card so the shown set:collector always
    // matches the shown art; fall back to the declared key when unresolved so an
    // owned printing without card data is still searchable by its code. One
    // canonical key for both uses: `scoreMatch` normalizes case itself, and the
    // display path re-cases only the set half (`formatPrintingLabel`).
    const setCollectorKey = card ? cardPrintingKey(card) : declaredKey
    const dedupKey = card
      ? `id:${card.id}`
      : declaredKey
        ? `p:${declaredKey}`
        : `n:${ref.name.toLowerCase()}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)
    out.push({
      cardName: card?.name ?? ref.name,
      setCollectorKey,
      card,
    })
  }
  return out
}

function topScored<T>(items: Scored<T>[], limit: number): T[] {
  items.sort((a, b) => b.score - a.score)
  return items.slice(0, limit).map((s) => s.entry)
}

interface QuickSwitchProps {
  open: boolean
  onClose: () => void
  decks: Accessor<DeckSummary[] | null>
  collections: Accessor<CollectionSummary[] | null>
  wantedLists: Accessor<WantedListSummary[] | null>
  currency: Accessor<PriceCurrency>
  useScryfallImgUrls: Accessor<boolean>
}

/**
 * The kind badge on a result row, and the sentence naming the list a card was
 * found in — both as message *keys*, since these tables are built once at
 * import and would otherwise pin the dialog to the boot-time language.
 *
 * The subtitle used to be `in ${noun} "${name}"` off a table of bare nouns.
 * Splicing a noun into a preposition phrase does not survive translation (the
 * preposition, the article and the noun's case all move together), so each list
 * kind now carries its whole sentence.
 */
const KIND_LABEL = {
  deck: 'site.quickSwitch.kindDeck',
  collection: 'site.quickSwitch.kindCollection',
  wanted: 'site.quickSwitch.kindWanted',
  commander: 'site.quickSwitch.kindCommander',
  card: 'site.quickSwitch.kindCard',
  printing: 'site.quickSwitch.kindPrinting',
} as const satisfies Record<ListKind | 'commander' | 'card' | 'printing', MessageKey>

const KIND_PARENT_MESSAGE = {
  deck: 'site.quickSwitch.inDeck',
  collection: 'site.quickSwitch.inCollection',
  wanted: 'site.quickSwitch.inWanted',
} as const satisfies Record<ListKind, MessageKey>

const MAX_LIST_RESULTS = 8
const MAX_COMMANDER_RESULTS = 6
const MAX_CARD_RESULTS = 12
const MAX_PRINTING_RESULTS = 12

function entryKindLabel(entry: QuickSwitchEntry, t: TranslateFn): string {
  if (entry.kind === 'list') return t(KIND_LABEL[entry.listKind])
  return t(KIND_LABEL[entry.kind])
}

function entryPrimary(entry: QuickSwitchEntry): string {
  if (entry.kind === 'list') return entry.name
  if (entry.kind === 'commander') return entry.commanderName
  if (entry.kind === 'card') return entry.cardName
  return entry.setCollectorDisplay
}

function entrySubtitle(entry: QuickSwitchEntry, t: TranslateFn): string | undefined {
  if (entry.kind === 'list') return entry.subtitle
  if (entry.kind === 'commander') {
    return t(KIND_PARENT_MESSAGE.deck, { name: entry.deckName })
  }
  return t(KIND_PARENT_MESSAGE[entry.parentKind], { name: entry.parentName })
}

export const QuickSwitch: Component<QuickSwitchProps> = (props) => {
  const { t, locale } = useI18n()
  const [query, setQuery] = createSignal('')
  const [activeIndex, setActiveIndex] = createSignal(0)
  const [details, setDetails] = createSignal<LoadedDetail[]>([])
  let inputEl: HTMLInputElement | undefined
  let listEl: HTMLDivElement | undefined
  let detailFetchStarted = false

  const fetchDetailFor = async (
    kind: ListKind,
    slug: string,
    listName: string,
  ): Promise<LoadedDetail | null> => {
    try {
      const data = await fetchJson<DetailPayload>(detailUrl(kind, slug))
      return { kind, slug, listName, candidates: buildCandidates(data) }
    } catch (e) {
      console.error(`QuickSwitch: failed to load ${kind}/${slug}:`, e)
      return null
    }
  }

  const loadAllDetails = async (
    decks: DeckSummary[],
    collections: CollectionSummary[],
    wantedLists: WantedListSummary[],
  ): Promise<void> => {
    const tasks: Promise<LoadedDetail | null>[] = []
    for (const d of decks) tasks.push(fetchDetailFor('deck', d.slug, d.name))
    for (const c of collections) tasks.push(fetchDetailFor('collection', c.slug, c.name))
    for (const w of wantedLists) tasks.push(fetchDetailFor('wanted', w.slug, w.name))
    const results = await Promise.all(tasks)
    setDetails(results.filter((r): r is LoadedDetail => r !== null))
  }

  const listEntries = createMemo<ListEntry[]>(() => {
    const cur = props.currency()
    // `getDeckCountLabel` and `t('domain.count.cards')` below both render text,
    // so this memo tracks the locale and re-derives every row on a switch.
    locale()
    const out: ListEntry[] = []
    for (const d of props.decks() ?? []) {
      const countLabel = getDeckCountLabel(d.format, d.cardCount)
      out.push({
        kind: 'list',
        listKind: 'deck',
        href: listHref('deck', d.slug),
        image: d.featuredCardImage || '',
        name: d.name,
        subtitle: d.commander ? t('site.index.commander', { name: d.commander }) : undefined,
        label: countLabel.primary,
        labelSuffix: countLabel.suffix,
        total: getSummaryTotalPrice(d, cur),
        missing: getSummaryMissingPriceCount(d, cur),
      })
    }
    for (const c of props.collections() ?? []) {
      out.push({
        kind: 'list',
        listKind: 'collection',
        href: listHref('collection', c.slug),
        image: c.featuredCardImage || '',
        name: c.name,
        label: t('domain.count.cards', { count: c.cardCount }),
        total: getSummaryTotalPrice(c, cur),
        missing: getSummaryMissingPriceCount(c, cur),
      })
    }
    for (const w of props.wantedLists() ?? []) {
      out.push({
        kind: 'list',
        listKind: 'wanted',
        href: listHref('wanted', w.slug),
        image: w.featuredCardImage || '',
        name: w.name,
        label: t('domain.count.cards', { count: w.cardCount }),
        total: getSummaryTotalPrice(w, cur),
        missing: getSummaryMissingPriceCount(w, cur),
      })
    }
    return out
  })

  const findCommanderMatches = (q: string): CommanderEntry[] => {
    const scored: Scored<CommanderEntry>[] = []
    for (const d of props.decks() ?? []) {
      if (!d.commander) continue
      const score = scoreMatch(d.commander, q)
      if (score < 0) continue
      scored.push({
        entry: {
          kind: 'commander',
          href: listHref('deck', d.slug),
          image: d.featuredCardImage || '',
          commanderName: d.commander,
          deckName: d.name,
        },
        score,
      })
    }
    return topScored(scored, MAX_COMMANDER_RESULTS)
  }

  const findCardMatches = (q: string): CardEntry[] => {
    const scored: Scored<CardEntry>[] = []
    const useScryfall = props.useScryfallImgUrls()
    for (const detail of details()) {
      // A card belongs in the "Card" results once per list, regardless of how
      // many printings of it the list's card map holds. Distinct printings are
      // surfaced separately by findPrintingMatches.
      const seenNames = new Set<string>()
      for (const cand of detail.candidates) {
        if (!cand.cardName) continue
        const nameKey = cand.cardName.toLowerCase()
        if (seenNames.has(nameKey)) continue
        seenNames.add(nameKey)
        const score = scoreMatch(cand.cardName, q)
        if (score < 0) continue
        const image = resolveCardThumbnailUrl(cand.card, useScryfall) ?? ''
        scored.push({
          entry: {
            kind: 'card',
            href: listHref(detail.kind, detail.slug),
            image,
            cardName: cand.cardName,
            parentKind: detail.kind,
            parentName: detail.listName,
          },
          score,
        })
      }
    }
    return topScored(scored, MAX_CARD_RESULTS)
  }

  const findPrintingMatches = (q: string): PrintingEntry[] => {
    const scored: Scored<PrintingEntry>[] = []
    const useScryfall = props.useScryfallImgUrls()
    for (const detail of details()) {
      for (const cand of detail.candidates) {
        if (!cand.setCollectorKey) continue
        const score = scoreMatch(cand.setCollectorKey, q)
        if (score < 0) continue
        const image = resolveCardThumbnailUrl(cand.card, useScryfall) ?? ''
        scored.push({
          entry: {
            kind: 'printing',
            href: listHref(detail.kind, detail.slug),
            image,
            setCollectorDisplay: formatPrintingKeyLabel(cand.setCollectorKey),
            cardName: cand.cardName || undefined,
            parentKind: detail.kind,
            parentName: detail.listName,
          },
          score,
        })
      }
    }
    return topScored(scored, MAX_PRINTING_RESULTS)
  }

  const findListMatches = (q: string): ListEntry[] => {
    const scored: Scored<ListEntry>[] = []
    for (const entry of listEntries()) {
      const score = scoreMatch(entry.name, q)
      if (score < 0) continue
      scored.push({ entry, score })
    }
    return topScored(scored, MAX_LIST_RESULTS)
  }

  const filtered = createMemo<QuickSwitchEntry[]>(() => {
    const q = query().trim()
    if (!q) return listEntries()
    return [
      ...findListMatches(q),
      ...findCommanderMatches(q),
      ...findCardMatches(q),
      ...findPrintingMatches(q),
    ]
  })

  createEffect(
    on(
      () => props.open,
      (isOpen) => {
        if (!isOpen) return
        setQuery('')
        setActiveIndex(0)
        queueMicrotask(() => inputEl?.focus())
        if (!detailFetchStarted) {
          const decks = props.decks()
          const collections = props.collections()
          const wantedLists = props.wantedLists()
          if (decks !== null && collections !== null && wantedLists !== null) {
            detailFetchStarted = true
            void loadAllDetails(decks, collections, wantedLists)
          }
        }
      },
    ),
  )

  createEffect(
    on(filtered, (results) => {
      if (activeIndex() >= results.length) setActiveIndex(0)
    }),
  )

  createEffect(
    on(activeIndex, (idx) => {
      if (!listEl) return
      const child = listEl.children[idx]
      if (child instanceof HTMLElement) child.scrollIntoView({ block: 'nearest' })
    }),
  )

  const navigateToEntry = (entry: QuickSwitchEntry): void => {
    props.onClose()
    window.location.assign(entry.href)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      props.onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const len = filtered().length
      if (len > 0) setActiveIndex((i) => (i + 1) % len)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const len = filtered().length
      if (len > 0) setActiveIndex((i) => (i - 1 + len) % len)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const entry = filtered()[activeIndex()]
      if (entry) navigateToEntry(entry)
    }
  }

  return (
    <Show when={props.open}>
      <div
        class="quick-switch-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label={t('site.quickSwitch.title')}
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose()
        }}
      >
        <div class="quick-switch-dialog" onKeyDown={onKeyDown}>
          <input
            ref={inputEl}
            class="quick-switch-input"
            type="text"
            placeholder={t('site.quickSwitch.placeholder')}
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value)
              setActiveIndex(0)
            }}
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck={false}
          />
          <div class="quick-switch-results" ref={listEl}>
            <Show
              when={filtered().length > 0}
              fallback={<div class="quick-switch-empty">{t('site.quickSwitch.noMatches')}</div>}
            >
              <For each={filtered()}>
                {(entry, i) => {
                  const subtitle = entrySubtitle(entry, t)
                  return (
                    <button
                      type="button"
                      class="quick-switch-row"
                      classList={{ 'quick-switch-row-active': activeIndex() === i() }}
                      onMouseEnter={() => setActiveIndex(i())}
                      onClick={() => navigateToEntry(entry)}
                    >
                      <div class="quick-switch-thumb">
                        <Show
                          when={entry.image}
                          fallback={<div class="quick-switch-thumb-empty" />}
                        >
                          <img src={entry.image} alt="" loading="lazy" />
                        </Show>
                      </div>
                      <div class="quick-switch-row-main">
                        <div class="quick-switch-row-title">
                          <span class="quick-switch-row-kind">{entryKindLabel(entry, t)}</span>
                          <span class="quick-switch-row-name">{entryPrimary(entry)}</span>
                          {entry.kind === 'printing' && entry.cardName ? (
                            <span class="quick-switch-row-name-aux">{entry.cardName}</span>
                          ) : null}
                        </div>
                        <Show when={subtitle}>
                          <div class="quick-switch-row-subtitle">{subtitle}</div>
                        </Show>
                      </div>
                      {entry.kind === 'list' ? (
                        <div class="quick-switch-row-meta">
                          <span class="quick-switch-row-count">
                            <span>{entry.label}</span>
                            <Show when={entry.labelSuffix}>
                              <span class="quick-switch-row-count-suffix">{entry.labelSuffix}</span>
                            </Show>
                          </span>
                          <span class="quick-switch-row-price">
                            {formatPriceWithMissing(entry.total, props.currency(), entry.missing)}
                          </span>
                        </div>
                      ) : null}
                    </button>
                  )
                }}
              </For>
            </Show>
          </div>
          <div class="quick-switch-footer">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> {t('site.quickSwitch.navigate')}
            </span>
            <span>
              {/* i18n-exempt: keyboard key names as printed on the key */}
              <kbd>Enter</kbd> {t('site.quickSwitch.open')}
            </span>
            <span>
              {/* i18n-exempt: keyboard key names as printed on the key */}
              <kbd>Esc</kbd> {t('site.quickSwitch.close')}
            </span>
          </div>
        </div>
      </div>
    </Show>
  )
}

export function useQuickSwitchShortcut(toggle: () => void): void {
  onMount(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'k' && e.key !== 'K') return
      if (!e.ctrlKey) return
      e.preventDefault()
      toggle()
    }
    document.addEventListener('keydown', handler)
    onCleanup(() => document.removeEventListener('keydown', handler))
  })
}
