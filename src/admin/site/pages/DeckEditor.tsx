import type { JSX } from 'solid-js'
import type { DeckData, ScryfallCard } from '../../../types'
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
  slug: string
  contentHash: string
}

export function DeckEditor(props: EditorSlugProps): JSX.Element {
  const defaults = useEditorDefaults('deck', 'admin')
  const lists = useAdminLists()
  const defaultCurrency = useDefaultCurrency()

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
  useSlugSync(ctrl.editor.slug, props)

  return (
    <DeckEditorBody
      ctrl={ctrl}
      defaults={defaults}
      search={adminSearch}
      currency={ctrl.editor.currency()}
      useScryfallImgUrls={true}
      enableImport={true}
    />
  )
}
