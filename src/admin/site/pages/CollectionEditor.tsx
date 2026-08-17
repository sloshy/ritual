import { createSignal, type JSX } from 'solid-js'
import type { ScryfallCard } from '../../../types'
import type { CardLabel } from '../../../card-labels'
import type { CardArtRecord } from '../../../card-art'
import type { CollectionCardEntry } from '../../../site/data-types'
import { ListLabelsModal } from '../components/ListLabelsModal'
import type { ListEditorConfig } from '../../../editor/useEditor'
import type { EntryCardDataActions } from '../../../editor/useEntryCardData'
import { collectExistingIds } from '../../../card-id'
import { useEditorDefaults } from '../../../editor/useEditorDefaults'
import { createApiCommit } from '../../../editor/commit'
import { applyChangeToCollection } from '../../../editor/collection-changes'
import { countsBySection, sectionOfTarget } from '../../../editor/section-helpers'
import { useFlatListEditController } from '../../../editor/flat-list-controller'
import {
  applyCollectionChangePrinting,
  collectionPrintingOf,
} from '../../../editor/collection-config'
import { CollectionEditorBody } from '../../../editor/CollectionEditorBody'
import { adminSearch, fetchAdminJson, fetchCardPrice } from '../editor-backend'
import { useAdminLists, moveTargetsExcluding } from '../move-targets'
import { useDefaultCurrency } from '../hooks/useDefaultCurrency'
import { type EditorSlugProps, useSlugSync } from '../hooks/useSlugSync'
import { useCardArt } from '../hooks/useCardArt'
import { sellModeEnabled } from '../sell-enabled'

type CollectionListResponse = { collections?: { slug: string; name: string }[] }

type CollectionDataResponse = {
  success: boolean
  entries: CollectionCardEntry[]
  sectionOrder?: string[]
  labels?: CardLabel[]
  customArt?: CardArtRecord
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  slug: string
  contentHash: string
}

export function CollectionEditor(props: EditorSlugProps): JSX.Element {
  const defaults = useEditorDefaults('collection', 'admin')
  const lists = useAdminLists()
  const defaultCurrency = useDefaultCurrency()
  // The list's default labels, seeded from each load and updated by the Labels
  // modal's save (front matter is not part of the card-change pipeline).
  const [listLabels, setListLabels] = createSignal<CardLabel[] | undefined>(undefined)
  const [labelsOpen, setLabelsOpen] = createSignal(false)
  const cardArt = useCardArt('collection')

  const buildConfig = (
    cardActions: EntryCardDataActions,
  ): ListEditorConfig<CollectionCardEntry[]> => ({
    currency: defaultCurrency,
    fetchList: () => fetchAdminJson('/api/collections'),
    extractListItems: (r) => (r as CollectionListResponse).collections ?? [],
    fetchData: (slug, signal) => fetchAdminJson(`/api/collection/${slug}`, signal),
    commit: createApiCommit(
      (slug) => `/api/collection/${slug}/save`,
      ({ changes, contentHash, sectionOrder, continueSession }) => ({
        changes,
        contentHash,
        sectionOrder,
        continueSession,
      }),
    ),
    entityLabel: 'collection',

    processLoadResponse: (response) => {
      const r = response as CollectionDataResponse
      // Adopted before the failure check: both are per-list state, so a failed
      // load must clear the previous list's labels and art rather than leave
      // them decorating whatever is on screen.
      setListLabels(r.labels)
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
      const r = response as CollectionDataResponse
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

    applyChange: applyChangeToCollection,
    applyChangePrinting: applyCollectionChangePrinting,
    hasData: (entries) => entries.length > 0,

    findCurrentFinish: (entries, cardName) =>
      entries.find((e) => e.name === cardName)?.finish ?? 'nonfoil',
    findOriginalFinish: (entries, cardName, cardId) =>
      entries.find((e) => (e.cardId !== undefined && e.cardId === cardId) || e.name === cardName)
        ?.finish ?? 'nonfoil',
    findCardId: (entries, cardName) => entries.find((e) => e.name === cardName)?.cardId,
    getOriginalIds: (entries) =>
      entries.map((e) => e.cardId).filter((id): id is number => id !== undefined),

    cardCountsBySection: countsBySection,
    cardSectionOf: sectionOfTarget,
    moveTargets: (currentSlug) => moveTargetsExcluding(lists(), 'collection', currentSlug),
  })

  const ctrl = useFlatListEditController<CollectionCardEntry>({
    buildConfig,
    initialSlug: props.initialSlug,
    applyChange: applyChangeToCollection,
    printingOf: collectionPrintingOf,
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
      <CollectionEditorBody
        enableSellMode={sellModeEnabled()}
        ctrl={ctrl}
        defaults={defaults}
        search={adminSearch}
        currency={ctrl.editor.currency()}
        useScryfallImgUrls={true}
        name={name()}
        listLabels={listLabels()}
        enableImport={true}
        onEditLabels={() => setLabelsOpen(true)}
        customArt={cardArt.art()}
        onSetCustomArt={cardArt.open}
      />
      <ListLabelsModal
        open={labelsOpen()}
        onClose={() => setLabelsOpen(false)}
        type="collection"
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
