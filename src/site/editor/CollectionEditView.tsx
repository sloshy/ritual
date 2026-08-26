import { type Component, createSignal } from 'solid-js'
import type { CollectionDetail, CollectionCardEntry } from '../../list/site-data'
import type { PriceCurrency } from '../../pricing/price-currency'
import type { ListRef } from '../../changes/change-event'
import type { NamedListRef } from '../../list-view/combined-list'
import type { ListEditorConfig } from '../../editor/useEditor'
import type { EntryCardDataActions } from '../../editor/useEntryCardData'
import { collectExistingIds } from '../../card/card-id'
import { useEditorDefaults } from '../../editor/useEditorDefaults'
import { applyChangeToCollection } from '../../changes/collection-changes'
import { countsBySection, sectionOfTarget } from '../../editor/section-helpers'
import { findEntryByIdOrName } from '../../changes/entry-targeting'
import { useFlatListEditController } from '../../editor/flat-list-controller'
import { applyCollectionChangePrinting, collectionPrintingOf } from '../../editor/collection-config'
import { CollectionEditorBody } from './CollectionEditorBody'
import { collectionToMarkdown, collectionToCsv, frontMatterFor } from '../../list/list-export'
import { CollectionPage } from '../CollectionPage'
import { siteSearch } from './site-search'
import { createPublicSwapSourceProvider } from './swap-sources'
import { backfillImportedCard } from './backfill-added-card'
import { EditViewFrame } from './EditViewFrame'
import { safeFilename } from './safe-filename'
import { useT } from '../../ui/i18n'

type CollectionEditViewProps = {
  detail: CollectionDetail
  slug: string
  currency: PriceCurrency
  /** Offer sell mode; true only on a site built with `site.sellMode` on. */
  enableSellMode?: boolean
  onExit: () => void
  /** Other lists a card can be moved into (excludes this collection). */
  moveTargets?: () => ListRef[]
  /** Every list on the site, for the toolbar's share filters (the page drops itself). */
  shareLists?: readonly NamedListRef[]
}

/** Public-site collection editor — mirrors {@link DeckEditView} for the flat collection list. */
export const CollectionEditView: Component<CollectionEditViewProps> = (props) => {
  const defaults = useEditorDefaults('collection')
  const [originalModalCard, setOriginalModalCard] = createSignal<string | null>(null)
  const t = useT()

  const buildConfig = (
    cardActions: EntryCardDataActions,
  ): ListEditorConfig<CollectionCardEntry[]> => ({
    currency: () => props.currency,
    fetchList: () => Promise.resolve(undefined),
    extractListItems: () => [{ slug: props.slug, name: props.detail.name }],
    fetchData: () => Promise.resolve(props.detail),
    showSelector: false,
    commit: () => Promise.resolve(undefined),
    entityLabel: 'collection',
    moveTargets: () => props.moveTargets?.() ?? [],
    swapSources: createPublicSwapSourceProvider(() => props.shareLists ?? []),

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
      backfillImportedCard(siteSearch, cardName, scryfallCard, cardActions.addCard),

    applyChange: applyChangeToCollection,
    applyChangePrinting: applyCollectionChangePrinting,
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
  })

  const ctrl = useFlatListEditController<CollectionCardEntry>({
    buildConfig,
    initialSlug: props.slug,
    applyChange: applyChangeToCollection,
    printingOf: collectionPrintingOf,
  })

  const changeCount = () => ctrl.editor.changes.changeCount()

  const safe = () => safeFilename(props.detail.name)

  return (
    <EditViewFrame
      changeCount={changeCount()}
      onDiscard={ctrl.editor.dialogs.openDiscard}
      onExit={props.onExit}
      jsonFilename={`${safe()}-edits.json`}
      kind="collection"
      slug={props.slug}
      listName={props.detail.name}
      onImport={(changes) => ctrl.editor.importChanges(changes)}
      onRestore={(changes) => ctrl.editor.restoreChanges(changes)}
      bulkEdit={ctrl.bulkEdit}
      changes={() => ctrl.editor.changes.changes()}
      ready={() => !ctrl.editor.status.loading && ctrl.editor.data() != null}
      onSwapPrintings={() => ctrl.openSwapPrintings('all')}
      fileExports={[
        {
          label: () => t('site.editor.downloadCollection'),
          filename: `${safe()}.md`,
          build: () =>
            collectionToMarkdown(
              props.detail.name,
              ctrl.editor.data() ?? [],
              ctrl.editor.sectionOrder(),
              frontMatterFor({
                description: props.detail.description,
                labels: props.detail.labels,
                image: props.detail.listImage,
              }),
            ),
        },
        {
          label: () => t('site.editor.downloadCollectionCsv'),
          filename: `${safe()}.csv`,
          mime: 'text/csv',
          build: () => collectionToCsv(ctrl.editor.data() ?? []),
        },
      ]}
      edited={
        <CollectionEditorBody
          ctrl={ctrl}
          defaults={defaults}
          search={siteSearch}
          currency={props.currency}
          useScryfallImgUrls={props.detail.useScryfallImgUrls}
          name={props.detail.name}
          description={props.detail.description}
          listLabels={props.detail.labels}
          showSave={false}
          showDiscard={false}
          fullWidth={false}
          enablePriceRefresh={true}
          enableTrade={true}
          enableSellMode={props.enableSellMode}
          bakedBuylist={() => props.detail.buylist}
          shareLists={props.shareLists}
          swap={ctrl.swapWizardProps({ currency: props.currency })}
        />
      }
      original={
        <CollectionPage
          name={props.detail.name}
          description={props.detail.description}
          entries={props.detail.entries}
          sectionOrder={props.detail.sectionOrder}
          listLabels={props.detail.labels}
          cards={props.detail.cards}
          printings={props.detail.printings ?? {}}
          symbolMap={props.detail.symbolMap}
          useScryfallImgUrls={props.detail.useScryfallImgUrls}
          totalPrice={props.detail.totalPrice}
          modalCardKey={originalModalCard()}
          onOpenModal={setOriginalModalCard}
          onCloseModal={() => setOriginalModalCard(null)}
          currency={props.currency}
          // Forwarded so the "Original" view's toolbar carries the sell control
          // that matches the buylist badges its tiles render: `buylistFieldsFor`
          // is gated on the global mode, not on this page's own support flag, so
          // without these the view would show prices with nothing to turn off.
          enableSellMode={props.enableSellMode}
          bakedBuylist={() => props.detail.buylist}
          // Forwarded so the "Original" toolbar offers the same share filters
          // as the edited side; the slug is what lets it exclude this
          // collection itself from the options.
          slug={props.slug}
          shareLists={props.shareLists}
        />
      }
    />
  )
}
