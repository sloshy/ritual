import { type Component, createSignal } from 'solid-js'
import type { DeckDetail } from '../data-types'
import type { PriceCurrency } from '../../price-currency'
import type { DeckData } from '../../types'
import type { ListRef } from '../../change-event'
import type { EditorConfig } from '../../editor/useEditor'
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
import { confirmDiscardOnExit } from './edit-session-memory'
import { safeFilename } from './safe-filename'

type DeckEditViewProps = {
  detail: DeckDetail
  slug: string
  currency: PriceCurrency
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

  const deckName = () => props.detail.deck.name

  const buildConfig = (cardActions: DeckCardDataActions): EditorConfig<DeckData> => ({
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

  const handleExit = () => {
    if (confirmDiscardOnExit(changeCount())) props.onExit()
  }

  return (
    <EditViewFrame
      changeCount={changeCount()}
      onDiscard={ctrl.editor.dialogs.openDiscard}
      onExit={handleExit}
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
          label: 'Download updated deck (.txt)',
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
        />
      }
    />
  )
}
