import { type Component, createSignal } from 'solid-js'
import type { WantedListDetail } from '../data-types'
import type { PriceCurrency } from '../../price-currency'
import type { WantedListCardEntry } from '../data-types'
import type { EditorConfig } from '../../editor/useEditor'
import type { EntryCardDataActions } from '../../editor/useEntryCardData'
import { collectExistingIds } from '../../card-id'
import { useEditorDefaults } from '../../editor/useEditorDefaults'
import { applyChangeToWantedList } from '../../editor/wanted-changes'
import { countsBySection, sectionOfTarget } from '../../editor/section-helpers'
import { useFlatListEditController } from '../../editor/flat-list-controller'
import { applyWantedChangePrinting, wantedPrintingOf } from '../../editor/wanted-config'
import { WantedEditorBody } from '../../editor/WantedEditorBody'
import { type ChangeFile, buildChangeFile } from '../../editor/change-file'
import { wantedToMarkdown } from '../../editor/list-export'
import { WantedListPage } from '../WantedListPage'
import { createScryfallSearchProvider } from './scryfall-search-provider'
import { backfillImportedCard } from './backfill-added-card'
import { EditViewFrame } from './EditViewFrame'
import { safeFilename } from './safe-filename'

const scryfallSearch = createScryfallSearchProvider()

type WantedEditViewProps = {
  detail: WantedListDetail
  slug: string
  currency: PriceCurrency
  onExit: () => void
}

/** Public-site wanted-list editor — mirrors {@link DeckEditView} for the flat wanted list. */
export const WantedEditView: Component<WantedEditViewProps> = (props) => {
  const defaults = useEditorDefaults('wanted')
  const [originalModalCard, setOriginalModalCard] = createSignal<string | null>(null)

  const buildConfig = (cardActions: EntryCardDataActions): EditorConfig<WantedListCardEntry[]> => ({
    fetchList: () => Promise.resolve(undefined),
    extractListItems: () => [{ slug: props.slug, name: props.detail.name }],
    fetchData: () => Promise.resolve(props.detail),
    showSelector: false,
    commit: () => Promise.resolve(undefined),
    entityLabel: 'wanted list',

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
  })

  const ctrl = useFlatListEditController<WantedListCardEntry>({
    buildConfig,
    initialSlug: props.slug,
    applyChange: applyChangeToWantedList,
    printingOf: wantedPrintingOf,
  })

  const changeCount = () => ctrl.editor.changes.changeCount()

  const buildFile = (): ChangeFile =>
    buildChangeFile({
      kind: 'wanted',
      slug: props.slug,
      name: props.detail.name,
      changes: ctrl.editor.changes.changes(),
      exportedAt: new Date().toISOString(),
    })

  const handleExit = () => {
    if (changeCount() > 0 && !window.confirm('Discard your edits and exit?')) return
    props.onExit()
  }

  const safe = () => safeFilename(props.detail.name)

  return (
    <EditViewFrame
      changeCount={changeCount()}
      onDiscard={ctrl.editor.dialogs.openDiscard}
      onExit={handleExit}
      jsonFilename={`${safe()}-edits.json`}
      buildFile={buildFile}
      storageKind="wanted"
      slug={props.slug}
      onImport={(changes) => ctrl.editor.importChanges(changes)}
      bulkEdit={ctrl.bulkEdit}
      fileExports={[
        {
          label: 'Download updated wanted list (.md)',
          filename: `${safe()}.md`,
          build: () =>
            wantedToMarkdown(
              props.detail.name,
              ctrl.editor.data() ?? [],
              ctrl.editor.sectionOrder(),
            ),
        },
      ]}
      edited={
        <WantedEditorBody
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
        <WantedListPage
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
