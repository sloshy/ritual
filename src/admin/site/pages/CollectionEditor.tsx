import { type JSX, createSignal, Show } from 'solid-js'
import type { ScryfallCard } from '../../../types'
import type { CollectionCardEntry } from '../../../site/data-types'
import type { CardPriceResponse } from '../../api/card-price'
import type { EditorConfig } from '../hooks/useEditor'
import { collectExistingIds } from '../../../card-id'
import { CollectionPage } from '../../../site/CollectionPage'
import { useEntryCardData } from '../hooks/useEntryCardData'
import { useEditor } from '../hooks/useEditor'
import { useEditorDefaults } from '../hooks/useEditorDefaults'
import { applyChangeToCollection } from '../types/collection-changes'
import { CardContextMenu } from '../components/CardContextMenu'
import { EditorShell } from '../components/EditorShell'

type CollectionListResponse = { collections?: { slug: string; name: string }[] }

type CollectionDataResponse = {
  success: boolean
  entries: CollectionCardEntry[]
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
        extra: {},
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

    buildSaveBody: ({ changes, contentHash }) => ({ changes, contentHash }),
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

  const handleContextMenu = (cardName: string, card: ScryfallCard | null, rect: DOMRect) => {
    editor.setContextMenuCard({ cardName, card, anchorRect: rect })
  }

  const closeModal = () => setModalCardKey(null)
  const closeContextMenu = () => editor.setContextMenuCard(null)

  return (
    <EditorShell
      heading="Collection Editor"
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
              onUnsetCommander={closeContextMenu}
              anchorRect={menu().anchorRect}
              onClose={closeContextMenu}
              hideCommander={true}
            />
          )}
        </Show>
      }
    >
      <CollectionPage
        name={editor.list().find((c) => c.slug === editor.slug())?.name ?? editor.slug()!}
        entries={editor.data()!}
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
        onAddCard={editor.dialogs.openSearchModal}
        onCardIncrement={handleIncrement}
        onCardDecrement={handleDecrement}
        onCardContextMenu={handleContextMenu}
        unsavedChangeCount={editor.changes.changeCount()}
      />
    </EditorShell>
  )
}
