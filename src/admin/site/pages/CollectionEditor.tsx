import { type JSX, batch, createSignal, Show } from 'solid-js'
import type { ScryfallCard } from '../../../types'
import type { CollectionCardEntry } from '../../../site/data-types'
import type { CardContextInfo } from '../types/context-menu'
import type { CardPriceResponse } from '../../api/card-price'
import type { EditorConfig, ChangePrintingContext } from '../hooks/useEditor'
import { type PrintingTuple, isSamePrinting } from '../../../change-event'
import { collectExistingIds } from '../../../card-id'
import { CollectionPage } from '../../../site/CollectionPage'
import { useEntryCardData } from '../hooks/useEntryCardData'
import { useEditor } from '../hooks/useEditor'
import { useEditorDefaults } from '../hooks/useEditorDefaults'
import { applyChangeToCollection } from '../types/collection-changes'
import { findEntryPrintingById } from '../types/entry-targeting'
import { CardContextMenu } from '../components/CardContextMenu'
import { EditorShell } from '../components/EditorShell'
import { countsBySection, sectionOfTarget } from '../types/section-helpers'

/**
 * Apply a "change printing" action to a collection. Each grouped copy is its own
 * single-card entry, so this retargets the first `count` entries of the tile's
 * group, emitting one set-printing change per entry. Untouched copies keep the
 * old printing and re-group into a separate tile.
 */
function applyCollectionChangePrinting(ctx: ChangePrintingContext<CollectionCardEntry[]>): void {
  const { target, count, options, tools, setData, original } = ctx
  const newPrinting: PrintingTuple = {
    set: options.set,
    collectorNumber: options.collectorNumber,
    finish: options.finish,
    condition: options.condition,
  }
  const currentPrinting: PrintingTuple = {
    set: target.set,
    collectorNumber: target.collectorNumber,
    finish: target.finish,
    condition: target.condition,
  }
  if (isSamePrinting(newPrinting, currentPrinting)) return

  const n = Math.min(Math.max(count, 1), target.cardIds.length)
  batch(() => {
    for (const cardId of target.cardIds.slice(0, n)) {
      const origPrinting = findEntryPrintingById(original, cardId) ?? currentPrinting
      tools.setPrinting(target.cardName, newPrinting, origPrinting, cardId)
      setData((prev) =>
        prev
          ? applyChangeToCollection(prev, {
              action: 'set-printing',
              cardName: target.cardName,
              set: options.set,
              collectorNumber: options.collectorNumber,
              finish: options.finish,
              condition: options.condition,
              cardId,
            })
          : prev,
      )
    }
  })
}

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
  const [cardData, cardActions] = useEntryCardData()
  const [modalCardKey, setModalCardKey] = createSignal<string | null>(null)
  const defaults = useEditorDefaults('collection')

  const config: EditorConfig<CollectionCardEntry[]> = {
    listEndpoint: '/api/collections',
    extractListItems: (r) => (r as CollectionListResponse).collections ?? [],
    dataEndpoint: (slug) => `/api/collection/${slug}`,
    saveEndpoint: (slug) => `/api/collection/${slug}/save`,
    entityLabel: 'collection',

    processLoadResponse: (response) => {
      const r = response as CollectionDataResponse
      if (!r.success) return null
      const poolIds = collectExistingIds(r.entries)
      return {
        data: r.entries,
        poolIds,
        contentHash: r.contentHash,
        extra: { sectionOrder: r.sectionOrder ?? [] },
      }
    },

    loadCardData: (response) => {
      const r = response as CollectionDataResponse
      cardActions.load({ cards: r.cards, printings: r.printings, symbolMap: r.symbolMap })
    },
    addCardData: (cardName, card, printings) => cardActions.addCard(cardName, card, printings),
    handlePriceResponse: (cardName, data: CardPriceResponse, hadCard) => {
      cardActions.setPrices(
        cardName,
        !hadCard ? (data.representative ?? undefined) : undefined,
        data.printings.length > 0 ? data.printings : undefined,
      )
    },

    applyChange: applyChangeToCollection,
    applyChangePrinting: applyCollectionChangePrinting,
    hasData: (entries) => entries.length > 0,

    findCurrentFinish: (entries, cardName) => {
      const entry = entries.find((e) => e.name === cardName)
      return entry?.finish ?? 'nonfoil'
    },
    findOriginalFinish: (entries, cardName, cardId) => {
      const entry = entries.find(
        (e) => (e.cardId !== undefined && e.cardId === cardId) || e.name === cardName,
      )
      return entry?.finish ?? 'nonfoil'
    },
    findCardId: (entries, cardName) => entries.find((e) => e.name === cardName)?.cardId,
    getOriginalIds: (entries) =>
      entries.map((e) => e.cardId).filter((id): id is number => id !== undefined),

    buildSaveBody: ({ changes, contentHash, sectionOrder }) => ({
      changes,
      contentHash,
      sectionOrder,
    }),

    cardCountsBySection: countsBySection,
    cardSectionOf: sectionOfTarget,
  }

  const editor = useEditor<CollectionCardEntry[], CollectionCardEntry>(config, props.initialSlug)

  const handleIncrement = (entry: CollectionCardEntry) => {
    const cardId = editor.pool.allocate()
    editor.changes.addCard(entry.name, {
      set: entry.set,
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      condition: entry.condition,
      cardId,
    })
    editor.setData((prev) =>
      prev
        ? applyChangeToCollection(prev, {
            action: 'add',
            cardName: entry.name,
            set: entry.set,
            collectorNumber: entry.collectorNumber,
            finish: entry.finish,
            condition: entry.condition,
            cardId,
          })
        : prev,
    )
  }

  const handleDecrement = (entry: CollectionCardEntry) => {
    if (entry.cardId !== undefined) {
      editor.pool.release(entry.cardId)
    }
    editor.changes.removeCard(
      entry.name,
      {
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
        condition: entry.condition,
        cardId: entry.cardId,
      },
      { ...entry },
    )
    editor.setData((prev) =>
      prev
        ? applyChangeToCollection(prev, {
            action: 'remove',
            cardName: entry.name,
            set: entry.set,
            collectorNumber: entry.collectorNumber,
            cardId: entry.cardId,
            fileOrder: entry.fileOrder,
          })
        : prev,
    )
  }

  const handleContextMenu = (info: CardContextInfo, rect: DOMRect) => {
    editor.setContextMenuCard({ ...info, anchorRect: rect })
  }

  const handleChangePrinting = () => {
    const menu = editor.contextMenuCard()
    editor.setContextMenuCard(null)
    if (menu) editor.startChangePrinting(menu)
  }

  const closeModal = () => setModalCardKey(null)
  const closeContextMenu = () => editor.setContextMenuCard(null)

  return (
    <EditorShell
      entityLabel="collection"
      selectorId="collection-select"
      selectorLabel="Select Collection"
      selectorPlaceholder="Choose a collection"
      editor={editor}
      cardData={cardData}
      requirePrinting={true}
      defaults={defaults}
      contextMenu={
        <Show when={editor.contextMenuCard()}>
          {(menu) => (
            <CardContextMenu
              cardName={menu().cardName}
              card={menu().card}
              currentFinish={editor.data()?.find((e) => e.name === menu().cardName)?.finish}
              onSetFoil={editor.handleSetFoil}
              onChangePrinting={handleChangePrinting}
              onUnsetCommander={closeContextMenu}
              anchorRect={menu().anchorRect}
              onClose={closeContextMenu}
              hideCommander={true}
              sections={editor.sectionOrder()}
              currentSection={editor.data() ? sectionOfTarget(editor.data()!, menu()) : undefined}
              onMoveToSection={(section) => editor.handleMoveCardToSection(menu(), section)}
              onCreateSection={() => editor.promptNewSectionForCard(menu())}
            />
          )}
        </Show>
      }
    >
      <CollectionPage
        name={editor.list().find((c) => c.slug === editor.slug())?.name ?? editor.slug()!}
        entries={editor.data()!}
        sectionOrder={editor.sectionOrder()}
        cards={cardData.cards}
        printings={cardData.printings}
        symbolMap={cardData.symbolMap}
        useScryfallImgUrls={true}
        totalPrice={0}
        modalCardKey={modalCardKey()}
        onOpenModal={setModalCardKey}
        onCloseModal={closeModal}
        currency={editor.currency}
        editMode={true}
        onCardIncrement={handleIncrement}
        onCardDecrement={handleDecrement}
        onCardContextMenu={handleContextMenu}
        unsavedChangeCount={editor.changes.changeCount()}
      />
    </EditorShell>
  )
}
