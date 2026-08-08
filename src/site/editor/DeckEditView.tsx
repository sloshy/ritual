import { type Component, createSignal } from 'solid-js'
import type { DeckDetail } from '../data-types'
import type { PriceCurrency } from '../../price-currency'
import type { DeckData } from '../../types'
import type { ListRef } from '../../change-event'
import type { ListEditorConfig } from '../../editor/useEditor'
import type { DeckCardDataActions } from '../../editor/useDeckCardData'
import { collectDeckCardIds } from '../../card-id'
import { useEditorDefaults } from '../../editor/useEditorDefaults'
import { applyChangeToDeck } from '../../editor/deck-changes'
import {
  applyDeckChangePrinting,
  findDeckFinish,
  findOriginalDeckFinish,
  findDeckCardId,
  getDeckCardIds,
  deckCountsBySection,
  findDeckCardSection,
} from '../../editor/deck-config'
import { useDeckEditController, DeckEditorBody } from '../../editor/DeckEditController'
import { deckToExportText } from '../../deck-text'
import { DeckPage } from '../DeckPage'
import { siteSearch } from './site-search'
import { backfillImportedCard } from './backfill-added-card'
import { EditViewFrame } from './EditViewFrame'
import { safeFilename } from './safe-filename'
import { useT } from '../../ui/i18n'

type DeckEditViewProps = {
  detail: DeckDetail
  slug: string
  currency: PriceCurrency
  /** Offer sell mode; true only on a site built with `site.sellMode` on. */
  enableSellMode?: boolean
  /** Leave edit mode, returning to the published deck view. */
  onExit: () => void
  /** Other lists a card can be moved into (excludes this deck). */
  moveTargets?: () => ListRef[]
}

/**
 * Public-site deck editor: mounts the shared editor against the already-loaded
 * deck JSON (no server). Edits are ephemeral; the visitor toggles between the
 * original and their edited copy, discards, or exports a change-list JSON / an
 * updated deck file.
 */
export const DeckEditView: Component<DeckEditViewProps> = (props) => {
  const defaults = useEditorDefaults('deck')
  const [originalModalCard, setOriginalModalCard] = createSignal<string | null>(null)
  const t = useT()

  const deckName = () => props.detail.deck.name

  const buildConfig = (cardActions: DeckCardDataActions): ListEditorConfig<DeckData> => ({
    currency: () => props.currency,
    // Single preloaded item — no list, no network. The selector is hidden.
    fetchList: () => Promise.resolve(undefined),
    extractListItems: () => [{ slug: props.slug, name: deckName() }],
    fetchData: () => Promise.resolve(props.detail),
    showSelector: false,
    // The public editor exports via the banner, not a save button — commit is unused.
    commit: () => Promise.resolve(undefined),
    entityLabel: 'deck',
    moveTargets: () => props.moveTargets?.() ?? [],

    // `applyChangeToDeck` clones on edit, so handing the editor the baked deck
    // directly is safe — the original is never mutated and a discard reloads it.
    processLoadResponse: () => ({
      data: props.detail.deck,
      poolIds: collectDeckCardIds(props.detail.deck),
      contentHash: '',
      extra: { frontMatter: {} },
    }),
    loadCardData: () =>
      cardActions.load({
        cards: props.detail.cards,
        printings: props.detail.printings,
        lowestPriceCards: props.detail.lowestPriceCards ?? {},
        lowestPriceCardsEur: props.detail.lowestPriceCardsEur ?? {},
        lowestPriceCardsTix: props.detail.lowestPriceCardsTix ?? {},
        symbolMap: props.detail.symbolMap,
      }),
    addCardData: (cardName, card, printings) => cardActions.addCard(cardName, card, printings),
    onCardAdded: (cardName, scryfallCard) =>
      backfillImportedCard(siteSearch, cardName, scryfallCard, cardActions.addCard),

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
  })

  const ctrl = useDeckEditController(buildConfig, props.slug)
  const changeCount = () => ctrl.editor.changes.changeCount()

  return (
    <EditViewFrame
      changeCount={changeCount()}
      onDiscard={ctrl.editor.dialogs.openDiscard}
      onExit={props.onExit}
      jsonFilename={`${safeFilename(deckName())}-edits.json`}
      kind="deck"
      slug={props.slug}
      listName={deckName()}
      onImport={(changes) => ctrl.editor.importChanges(changes)}
      onRestore={(changes) => ctrl.editor.restoreChanges(changes)}
      bulkEdit={ctrl.bulkEdit}
      changes={() => ctrl.editor.changes.changes()}
      ready={() => !ctrl.editor.status.loading && ctrl.editor.data() != null}
      fileExports={[
        {
          label: () => t('site.editor.downloadDeck'),
          filename: `${safeFilename(deckName())}.txt`,
          build: () => {
            const d = ctrl.editor.data()
            return d ? deckToExportText(d) : ''
          },
        },
      ]}
      edited={
        <DeckEditorBody
          ctrl={ctrl}
          defaults={defaults}
          search={siteSearch}
          currency={props.currency}
          useScryfallImgUrls={props.detail.useScryfallImgUrls}
          showSave={false}
          showDiscard={false}
          fullWidth={false}
          enablePriceRefresh={true}
          enableTrade={true}
          enableSellMode={props.enableSellMode}
          bakedBuylist={() => props.detail.buylist}
        />
      }
      original={
        <DeckPage
          deck={props.detail.deck}
          cards={props.detail.cards}
          printings={props.detail.printings ?? {}}
          lowestPriceCards={props.detail.lowestPriceCards}
          lowestPriceCardsEur={props.detail.lowestPriceCardsEur}
          lowestPriceCardsTix={props.detail.lowestPriceCardsTix}
          symbolMap={props.detail.symbolMap}
          useScryfallImgUrls={props.detail.useScryfallImgUrls}
          modalCardName={originalModalCard()}
          onOpenModal={setOriginalModalCard}
          onCloseModal={() => setOriginalModalCard(null)}
          currency={props.currency}
          slug={props.slug}
          // Forwarded so the "Original" view's toolbar carries the sell control
          // that matches the buylist badges its tiles render: `buylistFieldsFor`
          // is gated on the global mode, not on this page's own support flag, so
          // without these the view would show prices with nothing to turn off.
          enableSellMode={props.enableSellMode}
          bakedBuylist={() => props.detail.buylist}
        />
      }
    />
  )
}
