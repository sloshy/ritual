import type { Component, Accessor } from 'solid-js'
import { createSignal, createMemo, createEffect, on, onMount, onCleanup, For, Show } from 'solid-js'
import type { DeckSummary, CollectionSummary, WantedListSummary } from './data-types'
import type { ScryfallCard } from '../types'
import type { PriceCurrency } from '../price-currency'
import { formatPriceWithMissing } from '../price-currency'
import { resolveCardThumbnailUrl } from './image-sources'
import { scoreMatch } from './quick-switch-search'
import { fetchJson } from './useFetchJson'
import { getSummaryMissingPriceCount, getSummaryTotalPrice } from './utils'
import { getDeckCountLabel, pluralizeCards } from '../deck-format'

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

type DetailCardsPayload = { cards: Record<string, ScryfallCard | null> }

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

function buildCandidates(cards: Record<string, ScryfallCard | null>): CardCandidate[] {
  const seenCardIds = new Set<string>()
  const seenNullKeys = new Set<string>()
  const out: CardCandidate[] = []
  for (const [key, card] of Object.entries(cards)) {
    if (card) {
      if (seenCardIds.has(card.id)) continue
      seenCardIds.add(card.id)
      out.push({
        cardName: card.name,
        setCollectorKey: `${card.set}:${card.collector_number}`.toLowerCase(),
        card,
      })
      continue
    }
    if (seenNullKeys.has(key)) continue
    seenNullKeys.add(key)
    const isPrintingKey = key.includes(':')
    out.push({
      cardName: isPrintingKey ? '' : key,
      setCollectorKey: isPrintingKey ? key.toLowerCase() : null,
      card: null,
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

const KIND_LABEL: Record<ListKind | 'commander' | 'card' | 'printing', string> = {
  deck: 'Deck',
  collection: 'Collection',
  wanted: 'Wanted',
  commander: 'Commander',
  card: 'Card',
  printing: 'Printing',
}

const KIND_SUBTITLE_LABEL: Record<ListKind, string> = {
  deck: 'deck',
  collection: 'collection',
  wanted: 'wanted list',
}

const MAX_LIST_RESULTS = 8
const MAX_COMMANDER_RESULTS = 6
const MAX_CARD_RESULTS = 12
const MAX_PRINTING_RESULTS = 12

function detailUrl(kind: ListKind, slug: string): string {
  if (kind === 'deck') return `decks/${slug}.json`
  if (kind === 'collection') return `collections/${slug}.json`
  return `wanted/${slug}.json`
}

function listHref(kind: ListKind, slug: string): string {
  if (kind === 'deck') return `#/deck/${slug}`
  if (kind === 'collection') return `#/collection/${slug}`
  return `#/wanted/${slug}`
}

function entryKindLabel(entry: QuickSwitchEntry): string {
  if (entry.kind === 'list') return KIND_LABEL[entry.listKind]
  return KIND_LABEL[entry.kind]
}

function entryPrimary(entry: QuickSwitchEntry): string {
  if (entry.kind === 'list') return entry.name
  if (entry.kind === 'commander') return entry.commanderName
  if (entry.kind === 'card') return entry.cardName
  return entry.setCollectorDisplay
}

function entrySubtitle(entry: QuickSwitchEntry): string | undefined {
  if (entry.kind === 'list') return entry.subtitle
  if (entry.kind === 'commander') return `in ${KIND_SUBTITLE_LABEL.deck} "${entry.deckName}"`
  return `in ${KIND_SUBTITLE_LABEL[entry.parentKind]} "${entry.parentName}"`
}

export const QuickSwitch: Component<QuickSwitchProps> = (props) => {
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
      const data = await fetchJson<DetailCardsPayload>(detailUrl(kind, slug))
      return { kind, slug, listName, candidates: buildCandidates(data.cards) }
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
    const out: ListEntry[] = []
    for (const d of props.decks() ?? []) {
      const countLabel = getDeckCountLabel(d.format, d.cardCount)
      out.push({
        kind: 'list',
        listKind: 'deck',
        href: listHref('deck', d.slug),
        image: d.featuredCardImage || '',
        name: d.name,
        subtitle: d.commander ? `Commander: ${d.commander}` : undefined,
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
        label: pluralizeCards(c.cardCount),
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
        label: pluralizeCards(w.cardCount),
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
      for (const cand of detail.candidates) {
        if (!cand.cardName) continue
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
            setCollectorDisplay: cand.setCollectorKey.toUpperCase(),
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
        aria-label="Quick switch"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose()
        }}
      >
        <div class="quick-switch-dialog" onKeyDown={onKeyDown}>
          <input
            ref={inputEl}
            class="quick-switch-input"
            type="text"
            placeholder="Jump to a list, commander, or card..."
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
              fallback={<div class="quick-switch-empty">No matches</div>}
            >
              <For each={filtered()}>
                {(entry, i) => {
                  const subtitle = entrySubtitle(entry)
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
                          <span class="quick-switch-row-kind">{entryKindLabel(entry)}</span>
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
              <kbd>↓</kbd> navigate
            </span>
            <span>
              <kbd>Enter</kbd> open
            </span>
            <span>
              <kbd>Esc</kbd> close
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
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      toggle()
    }
    document.addEventListener('keydown', handler)
    onCleanup(() => document.removeEventListener('keydown', handler))
  })
}
