import { createMemo, createSignal, type JSX } from 'solid-js'
import type { ScryfallCard } from '../../../scryfall/types'
import type { CardKingdomCards, WantedListCardEntry } from '../../../list/site-data'
import type { CardArtRecord } from '../../../list/card-art'
import type { ListImageRef } from '../../../list/list-image'
import type { ListEditorConfig } from '../../../editor/editor-config'
import type { EntryCardDataActions } from '../../../editor/useEntryCardData'
import { collectExistingIds } from '../../../card/card-id'
import { useEditorDefaults } from '../../../editor/useEditorDefaults'
import { createApiCommit } from '../../../editor/commit'
import { applyChangeToWantedList } from '../../../changes/wanted-changes'
import { countsBySection, sectionOfTarget } from '../../../editor/section-helpers'
import { findEntryByIdOrName } from '../../../changes/entry-targeting'
import { useFlatListEditController } from '../../../editor/flat-list-controller'
import { applyWantedChangePrinting, wantedPrintingOf } from '../../../editor/wanted-config'
import { WantedEditorBody } from '../../../site/editor/WantedEditorBody'
import { adminSearch, fetchAdminJson, fetchCardPrice } from '../editor-backend'
import { useAdminLists, listInfosToNamedRefs, moveTargetsExcluding } from '../move-targets'
import { useDefaultCurrency } from '../hooks/useDefaultCurrency'
import { type EditorSlugProps, useSlugSync } from '../hooks/useSlugSync'
import { useCardArt } from '../hooks/useCardArt'
import { ListImageModal } from '../components/ListImageModal'
import { flatListImageCardOptions, type ListImageCardOption } from '../list-image-cards'
import { sellModeEnabled } from '../sell-enabled'

type WantedListListResponse = { wantedLists?: { slug: string; name: string }[] }

type WantedListDataResponse = {
  success: boolean
  entries: WantedListCardEntry[]
  sectionOrder?: string[]
  description?: string
  image?: ListImageRef
  customArt?: CardArtRecord
  cards: Record<string, ScryfallCard | null>
  cardsCardKingdom?: CardKingdomCards
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  slug: string
  contentHash: string
}

export function WantedListEditor(props: EditorSlugProps): JSX.Element {
  const defaults = useEditorDefaults('wanted', 'admin')
  const lists = useAdminLists()
  const defaultCurrency = useDefaultCurrency()
  const cardArt = useCardArt('wanted')
  const [ckCards, setCkCards] = createSignal<CardKingdomCards | undefined>(undefined)
  // The list's cover image, seeded from each load and updated by the Cover
  // Image modal's save — one of the two front-matter keys a wanted list carries
  // (the other is its description, below). The picker's rows come from the same
  // load body, so a card added in this session — whose `&N` exists only
  // client-side until the next save — is never offered.
  const [listImage, setListImage] = createSignal<ListImageRef | undefined>(undefined)
  // The list's blurb, seeded from each load. Read-only here: the description is
  // written by `ritual metadata`, the API and the MCP tool, and the editor shows
  // it so the page reads like the public one.
  const [description, setDescription] = createSignal<string | undefined>(undefined)
  const [imageCards, setImageCards] = createSignal<readonly ListImageCardOption[]>([])
  const [imageOpen, setImageOpen] = createSignal(false)

  const buildConfig = (
    cardActions: EntryCardDataActions,
  ): ListEditorConfig<WantedListCardEntry[]> => ({
    currency: defaultCurrency,
    fetchList: () => fetchAdminJson('/api/wanted'),
    extractListItems: (r) => (r as WantedListListResponse).wantedLists ?? [],
    fetchData: (slug, signal) => fetchAdminJson(`/api/wanted/${slug}`, signal),
    commit: createApiCommit(
      (slug) => `/api/wanted/${slug}/save`,
      ({ data, changes, contentHash, sectionOrder, continueSession }) => ({
        changes,
        entries: data,
        contentHash,
        sectionOrder,
        continueSession,
      }),
    ),
    entityLabel: 'wanted list',

    processLoadResponse: (response) => {
      const r = response as WantedListDataResponse
      // Adopted before the failure check: the cover and the art are per-list
      // state, so a failed load must clear the previous list's rather than
      // leave them decorating whatever is on screen.
      setListImage(r.image)
      setDescription(r.description)
      setImageCards(r.success ? flatListImageCardOptions(r.entries, r.cards) : [])
      // The ids the *saved* list holds: an art edit on any other card has to
      // wait for the save that gives its line an `&N`.
      cardArt.adopt(r.slug, r.customArt, r.success ? collectExistingIds(r.entries) : [])
      if (!r.success) return null
      return {
        data: r.entries,
        poolIds: collectExistingIds(r.entries),
        contentHash: r.contentHash,
        extra: { sectionOrder: r.sectionOrder ?? [] },
      }
    },

    loadCardData: (response) => {
      const r = response as WantedListDataResponse
      // Held beside the card store, not in it: the picks are baked per load
      // while the store is mutated as entries are added.
      setCkCards(r.cardsCardKingdom)
      cardActions.load({ cards: r.cards, printings: r.printings, symbolMap: r.symbolMap })
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
        scryfallCard ? undefined : (data.representative ?? undefined),
        data.printings.length > 0 ? data.printings : undefined,
      )
    },

    applyChange: applyChangeToWantedList,
    applyChangePrinting: applyWantedChangePrinting,
    hasData: (entries) => entries.length > 0,

    findCurrentFinish: (entries, cardName, cardId) =>
      findEntryByIdOrName(entries, cardName, cardId)?.finish ?? 'nonfoil',
    findOriginalFinish: (entries, cardName, cardId) =>
      findEntryByIdOrName(entries, cardName, cardId)?.finish ?? 'nonfoil',
    findCardId: (entries, cardName) => entries.find((e) => e.name === cardName)?.cardId,
    getOriginalIds: (entries) =>
      entries.map((e) => e.cardId).filter((id): id is number => id !== undefined),

    cardCountsBySection: countsBySection,
    cardSectionOf: sectionOfTarget,
    moveTargets: (currentSlug) => moveTargetsExcluding(lists(), 'wanted', currentSlug),
  })

  // Converted once per lists() change, so the array keeps its identity (and
  // the filter menu's option memos stay warm) across re-renders.
  const shareLists = createMemo(() => listInfosToNamedRefs(lists()))

  const ctrl = useFlatListEditController<WantedListCardEntry>({
    buildConfig,
    initialSlug: props.initialSlug,
    applyChange: applyChangeToWantedList,
    printingOf: wantedPrintingOf,
  })
  // Wired after the editor exists: a staged art write that fails *after* a
  // successful save has no dialog left to report into, so it takes over the
  // editor's own error banner.
  cardArt.attachStatus(ctrl.editor.statusActions)
  useSlugSync(ctrl.editor.slug, props)

  const name = () =>
    ctrl.editor.list().find((c) => c.slug === ctrl.editor.slug())?.name ?? ctrl.editor.slug() ?? ''

  return (
    <>
      <WantedEditorBody
        enableSellMode={sellModeEnabled()}
        ctrl={ctrl}
        defaults={defaults}
        search={adminSearch}
        currency={ctrl.editor.currency()}
        useScryfallImgUrls={true}
        name={name()}
        description={description()}
        enableImport={true}
        customArt={cardArt.art()}
        onSetCustomArt={cardArt.open}
        cardsCardKingdom={ckCards()}
        shareLists={shareLists()}
        onEditImage={() => setImageOpen(true)}
      />
      <ListImageModal
        open={imageOpen()}
        onClose={() => setImageOpen(false)}
        type="wanted"
        slug={ctrl.editor.slug()}
        image={listImage()}
        cards={imageCards()}
        contentHash={ctrl.editor.contentHash()}
        onSaved={(image, contentHash) => {
          setListImage(image)
          ctrl.editor.setContentHash(contentHash)
        }}
      />
    </>
  )
}
