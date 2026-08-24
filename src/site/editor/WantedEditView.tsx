import { type Component, createSignal } from 'solid-js'
import type { WantedListDetail } from '../data-types'
import type { PriceCurrency } from '../../price-currency'
import type { WantedListCardEntry } from '../data-types'
import type { ListRef } from '../../change-event'
import type { NamedListRef } from '../combined-list'
import type { ListEditorConfig } from '../../editor/useEditor'
import type { EntryCardDataActions } from '../../editor/useEntryCardData'
import { collectExistingIds } from '../../card-id'
import { useEditorDefaults } from '../../editor/useEditorDefaults'
import { applyChangeToWantedList } from '../../editor/wanted-changes'
import { countsBySection, sectionOfTarget } from '../../editor/section-helpers'
import { findEntryByIdOrName } from '../../editor/entry-targeting'
import { useFlatListEditController } from '../../editor/flat-list-controller'
import { applyWantedChangePrinting, wantedPrintingOf } from '../../editor/wanted-config'
import { WantedEditorBody } from '../../editor/WantedEditorBody'
import { frontMatterFor, wantedToMarkdown } from '../../editor/list-export'
import { WantedListPage } from '../WantedListPage'
import { siteSearch } from './site-search'
import { backfillImportedCard } from './backfill-added-card'
import { EditViewFrame } from './EditViewFrame'
import { safeFilename } from './safe-filename'
import { useT } from '../../ui/i18n'

type WantedEditViewProps = {
  detail: WantedListDetail
  slug: string
  currency: PriceCurrency
  /** Offer sell mode; true only on a site built with `site.sellMode` on. */
  enableSellMode?: boolean
  onExit: () => void
  /** Other lists a card can be moved into (excludes this wanted list). */
  moveTargets?: () => ListRef[]
  /** Every list on the site, for the toolbar's share filters (the page drops itself). */
  shareLists?: readonly NamedListRef[]
}

/** Public-site wanted-list editor — mirrors {@link DeckEditView} for the flat wanted list. */
export const WantedEditView: Component<WantedEditViewProps> = (props) => {
  const defaults = useEditorDefaults('wanted')
  const [originalModalCard, setOriginalModalCard] = createSignal<string | null>(null)
  const t = useT()

  const buildConfig = (
    cardActions: EntryCardDataActions,
  ): ListEditorConfig<WantedListCardEntry[]> => ({
    currency: () => props.currency,
    fetchList: () => Promise.resolve(undefined),
    extractListItems: () => [{ slug: props.slug, name: props.detail.name }],
    fetchData: () => Promise.resolve(props.detail),
    showSelector: false,
    commit: () => Promise.resolve(undefined),
    entityLabel: 'wanted list',
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
      backfillImportedCard(siteSearch, cardName, scryfallCard, cardActions.addCard),

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
  })

  const ctrl = useFlatListEditController<WantedListCardEntry>({
    buildConfig,
    initialSlug: props.slug,
    applyChange: applyChangeToWantedList,
    printingOf: wantedPrintingOf,
  })

  const changeCount = () => ctrl.editor.changes.changeCount()

  const safe = () => safeFilename(props.detail.name)

  return (
    <EditViewFrame
      changeCount={changeCount()}
      onDiscard={ctrl.editor.dialogs.openDiscard}
      onExit={props.onExit}
      jsonFilename={`${safe()}-edits.json`}
      kind="wanted"
      slug={props.slug}
      listName={props.detail.name}
      onImport={(changes) => ctrl.editor.importChanges(changes)}
      onRestore={(changes) => ctrl.editor.restoreChanges(changes)}
      bulkEdit={ctrl.bulkEdit}
      changes={() => ctrl.editor.changes.changes()}
      ready={() => !ctrl.editor.status.loading && ctrl.editor.data() != null}
      fileExports={[
        {
          label: () => t('site.editor.downloadWanted'),
          filename: `${safe()}.md`,
          build: () =>
            wantedToMarkdown(
              props.detail.name,
              ctrl.editor.data() ?? [],
              ctrl.editor.sectionOrder(),
              frontMatterFor({ image: props.detail.listImage }),
            ),
        },
      ]}
      edited={
        <WantedEditorBody
          ctrl={ctrl}
          defaults={defaults}
          search={siteSearch}
          currency={props.currency}
          useScryfallImgUrls={props.detail.useScryfallImgUrls}
          name={props.detail.name}
          showSave={false}
          showDiscard={false}
          fullWidth={false}
          enablePriceRefresh={true}
          enableTrade={true}
          enableSellMode={props.enableSellMode}
          bakedBuylist={() => props.detail.buylist}
          cardsCardKingdom={props.detail.cardsCardKingdom}
          shareLists={props.shareLists}
        />
      }
      original={
        <WantedListPage
          name={props.detail.name}
          entries={props.detail.entries}
          sectionOrder={props.detail.sectionOrder}
          cards={props.detail.cards}
          cardsCardKingdom={props.detail.cardsCardKingdom}
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
          // as the edited side; the slug is what lets it exclude this wanted
          // list itself from the options.
          slug={props.slug}
          shareLists={props.shareLists}
        />
      }
    />
  )
}
