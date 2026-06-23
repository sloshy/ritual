import type { JSX } from 'solid-js'
import type { ScryfallCard } from '../../../types'
import type { CollectionCardEntry } from '../../../site/data-types'
import type { EditorConfig } from '../../../editor/useEditor'
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

type CollectionListResponse = { collections?: { slug: string; name: string }[] }

type CollectionDataResponse = {
  success: boolean
  entries: CollectionCardEntry[]
  sectionOrder?: string[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  slug: string
  contentHash: string
}

type CollectionEditorProps = { initialSlug?: string | null }

export function CollectionEditor(props: CollectionEditorProps): JSX.Element {
  const defaults = useEditorDefaults('collection', 'admin')
  const lists = useAdminLists()
  // Late-bound so the config (built before the controller) can read the live slug.
  let currentSlug: () => string | null = () => props.initialSlug ?? null

  const buildConfig = (cardActions: EntryCardDataActions): EditorConfig<CollectionCardEntry[]> => ({
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
    moveTargets: () => moveTargetsExcluding(lists(), 'collection', currentSlug()),
  })

  const ctrl = useFlatListEditController<CollectionCardEntry>({
    buildConfig,
    initialSlug: props.initialSlug,
    applyChange: applyChangeToCollection,
    printingOf: collectionPrintingOf,
  })
  currentSlug = () => ctrl.editor.slug()

  const name = () =>
    ctrl.editor.list().find((c) => c.slug === ctrl.editor.slug())?.name ?? ctrl.editor.slug() ?? ''

  return (
    <CollectionEditorBody
      ctrl={ctrl}
      defaults={defaults}
      search={adminSearch}
      currency={ctrl.editor.currency}
      useScryfallImgUrls={true}
      name={name()}
      enableImport={true}
    />
  )
}
