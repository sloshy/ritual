import type { JSX } from 'solid-js'
import type { ScryfallCard } from '../../../types'
import type { WantedListCardEntry } from '../../../site/data-types'
import type { EditorConfig } from '../../../editor/useEditor'
import type { EntryCardDataActions } from '../../../editor/useEntryCardData'
import { collectExistingIds } from '../../../card-id'
import { useEditorDefaults } from '../../../editor/useEditorDefaults'
import { createApiCommit } from '../../../editor/commit'
import { applyChangeToWantedList } from '../../../editor/wanted-changes'
import { countsBySection, sectionOfTarget } from '../../../editor/section-helpers'
import { useFlatListEditController } from '../../../editor/flat-list-controller'
import { applyWantedChangePrinting, wantedPrintingOf } from '../../../editor/wanted-config'
import { WantedEditorBody } from '../../../editor/WantedEditorBody'
import { adminSearch, fetchAdminJson, fetchCardPrice } from '../editor-backend'
import { useAdminLists, moveTargetsExcluding } from '../move-targets'

type WantedListListResponse = { wantedLists?: { slug: string; name: string }[] }

type WantedListDataResponse = {
  success: boolean
  entries: WantedListCardEntry[]
  sectionOrder?: string[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  slug: string
  contentHash: string
}

type WantedListEditorProps = { initialSlug?: string | null }

export function WantedListEditor(props: WantedListEditorProps): JSX.Element {
  const defaults = useEditorDefaults('wanted', 'admin')
  const lists = useAdminLists()
  // Late-bound so the config (built before the controller) can read the live slug.
  let currentSlug: () => string | null = () => props.initialSlug ?? null

  const buildConfig = (cardActions: EntryCardDataActions): EditorConfig<WantedListCardEntry[]> => ({
    fetchList: () => fetchAdminJson('/api/wanted'),
    extractListItems: (r) => (r as WantedListListResponse).wantedLists ?? [],
    fetchData: (slug, signal) => fetchAdminJson(`/api/wanted/${slug}`, signal),
    commit: createApiCommit(
      (slug) => `/api/wanted/${slug}/save`,
      ({ data, changes, contentHash, sectionOrder }) => ({
        changes,
        entries: data,
        contentHash,
        sectionOrder,
      }),
    ),
    entityLabel: 'wanted list',

    processLoadResponse: (response) => {
      const r = response as WantedListDataResponse
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

    applyChange: applyChangeToWantedList,
    applyChangePrinting: applyWantedChangePrinting,
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
    moveTargets: () => moveTargetsExcluding(lists(), 'wanted', currentSlug()),
  })

  const ctrl = useFlatListEditController<WantedListCardEntry>({
    buildConfig,
    initialSlug: props.initialSlug,
    applyChange: applyChangeToWantedList,
    printingOf: wantedPrintingOf,
  })
  currentSlug = () => ctrl.editor.slug()

  const name = () =>
    ctrl.editor.list().find((c) => c.slug === ctrl.editor.slug())?.name ?? ctrl.editor.slug() ?? ''

  return (
    <WantedEditorBody
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
