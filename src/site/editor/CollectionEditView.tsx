import { type Component, createSignal } from 'solid-js'
import type { CollectionDetail } from '../data-types'
import type { PriceCurrency } from '../../price-currency'
import type { CollectionCardEntry } from '../data-types'
import type { ListRef } from '../../change-event'
import type { EditorConfig } from '../../editor/useEditor'
import type { EntryCardDataActions } from '../../editor/useEntryCardData'
import { collectExistingIds } from '../../card-id'
import { useEditorDefaults } from '../../editor/useEditorDefaults'
import { applyChangeToCollection } from '../../editor/collection-changes'
import { countsBySection, sectionOfTarget } from '../../editor/section-helpers'
import { useFlatListEditController } from '../../editor/flat-list-controller'
import { applyCollectionChangePrinting, collectionPrintingOf } from '../../editor/collection-config'
import { CollectionEditorBody } from '../../editor/CollectionEditorBody'
import { collectionToMarkdown, collectionToCsv } from '../../editor/list-export'
import { CollectionPage } from '../CollectionPage'
import { createScryfallSearchProvider } from './scryfall-search-provider'
import { backfillImportedCard } from './backfill-added-card'
import { EditViewFrame } from './EditViewFrame'
import { confirmDiscardOnExit } from './edit-session-memory'
import { safeFilename } from './safe-filename'

const scryfallSearch = createScryfallSearchProvider()

type CollectionEditViewProps = {
  detail: CollectionDetail
  slug: string
  currency: PriceCurrency
  onExit: () => void
  /** Other lists a card can be moved into (excludes this collection). */
  moveTargets?: () => ListRef[]
}

/** Public-site collection editor — mirrors {@link DeckEditView} for the flat collection list. */
export const CollectionEditView: Component<CollectionEditViewProps> = (props) => {
  const defaults = useEditorDefaults('collection')
  const [originalModalCard, setOriginalModalCard] = createSignal<string | null>(null)

  const buildConfig = (cardActions: EntryCardDataActions): EditorConfig<CollectionCardEntry[]> => ({
    currency: () => props.currency,
    fetchList: () => Promise.resolve(undefined),
    extractListItems: () => [{ slug: props.slug, name: props.detail.name }],
    fetchData: () => Promise.resolve(props.detail),
    showSelector: false,
    commit: () => Promise.resolve(undefined),
    entityLabel: 'collection',
    moveTargets: () => props.moveTargets?.() ?? [],

    processLoadResponse: () => ({
      data: props.detail.entries,
      poolIds: collectExistingIds(props.detail.entries),
      contentHash: '',
      extra: { sectionOrder: props.detail.sectionOrder ?? [] },
    }),
    loadCardData: () =>
      cardActions.load({
        cards: props.detail.cards,
        printings: props.detail.printings,
        symbolMap: props.detail.symbolMap,
      }),
    addCardData: (cardName, card, printings) => cardActions.addCard(cardName, card, printings),
    onCardAdded: (cardName, scryfallCard) =>
      backfillImportedCard(scryfallSearch, cardName, scryfallCard, cardActions.addCard),

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
  })

  const ctrl = useFlatListEditController<CollectionCardEntry>({
    buildConfig,
    initialSlug: props.slug,
    applyChange: applyChangeToCollection,
    printingOf: collectionPrintingOf,
  })

  const changeCount = () => ctrl.editor.changes.changeCount()

  const handleExit = () => {
    if (confirmDiscardOnExit(changeCount())) props.onExit()
  }

  const safe = () => safeFilename(props.detail.name)

  return (
    <EditViewFrame
      changeCount={changeCount()}
      onDiscard={ctrl.editor.dialogs.openDiscard}
      onExit={handleExit}
      jsonFilename={`${safe()}-edits.json`}
      kind="collection"
      slug={props.slug}
      listName={props.detail.name}
      onImport={(changes) => ctrl.editor.importChanges(changes)}
      onRestore={(changes) => ctrl.editor.restoreChanges(changes)}
      bulkEdit={ctrl.bulkEdit}
      changes={() => ctrl.editor.changes.changes()}
      ready={() => !ctrl.editor.status.loading && ctrl.editor.data() != null}
      fileExports={[
        {
          label: 'Download updated collection (.md)',
          filename: `${safe()}.md`,
          build: () =>
            collectionToMarkdown(
              props.detail.name,
              ctrl.editor.data() ?? [],
              ctrl.editor.sectionOrder(),
            ),
        },
        {
          label: 'Download CSV',
          filename: `${safe()}.csv`,
          mime: 'text/csv',
          build: () => collectionToCsv(ctrl.editor.data() ?? []),
        },
      ]}
      edited={
        <CollectionEditorBody
          ctrl={ctrl}
          defaults={defaults}
          search={scryfallSearch}
          currency={props.currency}
          useScryfallImgUrls={props.detail.useScryfallImgUrls}
          name={props.detail.name}
          showSave={false}
          showDiscard={false}
          fullWidth={false}
          enablePriceRefresh={true}
          enableTrade={true}
        />
      }
      original={
        <CollectionPage
          name={props.detail.name}
          entries={props.detail.entries}
          sectionOrder={props.detail.sectionOrder}
          cards={props.detail.cards}
          printings={props.detail.printings ?? {}}
          symbolMap={props.detail.symbolMap}
          useScryfallImgUrls={props.detail.useScryfallImgUrls}
          totalPrice={props.detail.totalPrice}
          modalCardKey={originalModalCard()}
          onOpenModal={setOriginalModalCard}
          onCloseModal={() => setOriginalModalCard(null)}
          currency={props.currency}
        />
      }
    />
  )
}
