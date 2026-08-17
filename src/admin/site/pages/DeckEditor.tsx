import { createSignal, type JSX } from 'solid-js'
import type { DeckData, ScryfallCard } from '../../../types'
import type { CardLabel } from '../../../card-labels'
import type { CardArtRecord } from '../../../card-art'
import type { ListEditorConfig } from '../../../editor/useEditor'
import type { DeckCardDataActions } from '../../../editor/useDeckCardData'
import { collectDeckCardIds } from '../../../card-id'
import { useEditorDefaults } from '../../../editor/useEditorDefaults'
import { createApiCommit } from '../../../editor/commit'
import { applyChangeToDeck } from '../../../editor/deck-changes'
import {
  applyDeckChangePrinting,
  findDeckFinish,
  findOriginalDeckFinish,
  findDeckCardId,
  getDeckCardIds,
  deckCountsBySection,
  findDeckCardSection,
} from '../../../editor/deck-config'
import { useDeckEditController, DeckEditorBody } from '../../../editor/DeckEditController'
import { adminSearch, fetchAdminJson, fetchCardPrice } from '../editor-backend'
import { useAdminLists, moveTargetsExcluding } from '../move-targets'
import { useDefaultCurrency } from '../hooks/useDefaultCurrency'
import { type EditorSlugProps, useSlugSync } from '../hooks/useSlugSync'
import { useCardArt } from '../hooks/useCardArt'
import { ListLabelsModal } from '../components/ListLabelsModal'
import { sellModeEnabled } from '../sell-enabled'

type DeckListResponse = { decks?: { slug: string; name: string }[] }

type DeckDataResponse = {
  success: boolean
  deck: DeckData
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  lowestPriceCards: Record<string, ScryfallCard | null>
  lowestPriceCardsEur: Record<string, ScryfallCard | null>
  lowestPriceCardsTix: Record<string, ScryfallCard | null>
  symbolMap: Record<string, string>
  frontMatter: Record<string, unknown>
  labels?: CardLabel[]
  customArt?: CardArtRecord
  slug: string
  contentHash: string
}

export function DeckEditor(props: EditorSlugProps): JSX.Element {
  const defaults = useEditorDefaults('deck', 'admin')
  const lists = useAdminLists()
  const defaultCurrency = useDefaultCurrency()
  const cardArt = useCardArt('deck')
  // The deck's default card labels, seeded from each load and updated by the
  // Labels modal's save (front matter is not part of the card-change pipeline).
  const [listLabels, setListLabels] = createSignal<CardLabel[] | undefined>(undefined)
  const [labelsOpen, setLabelsOpen] = createSignal(false)

  const buildConfig = (cardActions: DeckCardDataActions): ListEditorConfig<DeckData> => ({
    currency: defaultCurrency,
    fetchList: () => fetchAdminJson('/api/decks'),
    extractListItems: (r) => (r as DeckListResponse).decks ?? [],
    fetchData: (slug, signal) => fetchAdminJson(`/api/deck/${slug}`, signal),
    commit: createApiCommit(
      (slug) => `/api/deck/${slug}/save`,
      ({ data, changes, contentHash, extra, continueSession }) => ({
        changes,
        deck: data,
        frontMatter: extra.frontMatter,
        contentHash,
        continueSession,
      }),
    ),
    entityLabel: 'deck',

    processLoadResponse: (response) => {
      const r = response as DeckDataResponse
      // Adopted before the failure check: both are per-list state, so a failed
      // load must clear the previous deck's labels and art rather than leave
      // them decorating whatever is on screen.
      setListLabels(r.labels)
      // The ids the *saved* deck holds: an art edit on any other card has to
      // wait for the save that gives its line an `&N`.
      cardArt.adopt(r.slug, r.customArt, r.success ? collectDeckCardIds(r.deck) : [])
      if (!r.success) return null
      return {
        data: r.deck,
        poolIds: collectDeckCardIds(r.deck),
        contentHash: r.contentHash,
        extra: { frontMatter: r.frontMatter },
      }
    },

    loadCardData: (response) => {
      const r = response as DeckDataResponse
      cardActions.load({
        cards: r.cards,
        printings: r.printings,
        lowestPriceCards: r.lowestPriceCards,
        lowestPriceCardsEur: r.lowestPriceCardsEur,
        lowestPriceCardsTix: r.lowestPriceCardsTix,
        symbolMap: r.symbolMap,
      })
    },
    addCardData: (cardName, card, printings) => cardActions.addCard(cardName, card, printings),
    onCardArt: cardArt.stage,
    onCardArtReset: cardArt.reset,
    onSaved: cardArt.flush,
    onCardAdded: async (cardName, scryfallCard) => {
      const data = await fetchCardPrice(cardName)
      if (!data) return
      cardActions.setPrices(
        cardName,
        data.lowestPriceCard,
        data.lowestPriceCardEur,
        data.lowestPriceCardTix,
        scryfallCard ? undefined : (data.representative ?? undefined),
        data.printings.length > 0 ? data.printings : undefined,
      )
    },

    applyChange: applyChangeToDeck,
    applyChangePrinting: applyDeckChangePrinting,
    hasData: () => true,
    findCurrentFinish: findDeckFinish,
    findOriginalFinish: findOriginalDeckFinish,
    findCardId: findDeckCardId,
    getOriginalIds: getDeckCardIds,

    sectionsOf: (deck) => deck.sections.map((s) => s.name),
    cardCountsBySection: deckCountsBySection,
    cardSectionOf: findDeckCardSection,
    moveTargets: (currentSlug) => moveTargetsExcluding(lists(), 'deck', currentSlug),
  })

  const ctrl = useDeckEditController(buildConfig, props.initialSlug)
  // Wired after the editor exists: a staged art write that fails *after* a
  // successful save has no dialog left to report into, so it takes over the
  // editor's own error banner.
  cardArt.attachStatus(ctrl.editor.statusActions)
  useSlugSync(ctrl.editor.slug, props)

  return (
    <>
      <DeckEditorBody
        enableSellMode={sellModeEnabled()}
        ctrl={ctrl}
        defaults={defaults}
        search={adminSearch}
        currency={ctrl.editor.currency()}
        useScryfallImgUrls={true}
        enableImport={true}
        listLabels={listLabels()}
        onEditLabels={() => setLabelsOpen(true)}
        customArt={cardArt.art()}
        onSetCustomArt={cardArt.open}
      />
      <ListLabelsModal
        open={labelsOpen()}
        onClose={() => setLabelsOpen(false)}
        type="deck"
        slug={ctrl.editor.slug()}
        labels={listLabels()}
        contentHash={ctrl.editor.contentHash()}
        onSaved={(labels, contentHash) => {
          setListLabels(labels)
          ctrl.editor.setContentHash(contentHash)
        }}
      />
    </>
  )
}
