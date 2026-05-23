import { type JSX, createSignal, Show } from 'solid-js'
import type { ScryfallCard } from '../../../types'
import type { WantedListCardEntry } from '../../../site/data-types'
import type { CardPriceResponse } from '../../api/card-price'
import type { EditorConfig } from '../hooks/useEditor'
import { collectExistingIds } from '../../../card-id'
import { WantedListPage } from '../../../site/WantedListPage'
import { useEntryCardData } from '../hooks/useEntryCardData'
import { useEditor } from '../hooks/useEditor'
import { useEditorDefaults } from '../hooks/useEditorDefaults'
import { applyChangeToWantedList } from '../types/wanted-changes'
import { CardContextMenu } from '../components/CardContextMenu'
import { EditorShell } from '../components/EditorShell'

type WantedListListResponse = { wantedLists?: { slug: string; name: string }[] }

type WantedListDataResponse = {
  success: boolean
  entries: WantedListCardEntry[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  slug: string
  contentHash: string
}

type WantedListEditorProps = { initialSlug?: string | null }

export function WantedListEditor(props: WantedListEditorProps): JSX.Element {
  const [cardData, cardActions] = useEntryCardData()
  const [modalCardKey, setModalCardKey] = createSignal<string | null>(null)
  const defaults = useEditorDefaults('wanted')

  const config: EditorConfig<WantedListCardEntry[]> = {
    listEndpoint: '/api/wanted',
    extractListItems: (r) => (r as WantedListListResponse).wantedLists ?? [],
    dataEndpoint: (slug) => `/api/wanted/${slug}`,
    saveEndpoint: (slug) => `/api/wanted/${slug}/save`,
    entityLabel: 'wanted list',

    processLoadResponse: (response) => {
      const r = response as WantedListDataResponse
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
      const r = response as WantedListDataResponse
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

    applyChange: applyChangeToWantedList,
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

    buildSaveBody: ({ data, changes, contentHash }) => ({
      changes,
      entries: data,
      contentHash,
    }),
  }

  const editor = useEditor<WantedListCardEntry[], WantedListCardEntry>(config, props.initialSlug)

  const handleIncrement = (entry: WantedListCardEntry) => {
    const cardId = editor.pool.allocate()
    editor.changes.addCard(entry.name, {
      set: entry.set,
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      cardId,
    })
    editor.setData((prev) =>
      prev
        ? applyChangeToWantedList(prev, {
            action: 'add',
            cardName: entry.name,
            set: entry.set,
            collectorNumber: entry.collectorNumber,
            finish: entry.finish,
            cardId,
          })
        : prev,
    )
  }

  const handleDecrement = (entry: WantedListCardEntry) => {
    if (entry.cardId !== undefined) {
      editor.pool.release(entry.cardId)
    }
    editor.changes.removeCard(
      entry.name,
      {
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
        cardId: entry.cardId,
      },
      { ...entry },
    )
    editor.setData((prev) =>
      prev
        ? applyChangeToWantedList(prev, {
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
      heading="Wanted List Editor"
      selectorId="wanted-list-select"
      selectorLabel="Select Wanted List"
      selectorPlaceholder="Choose a wanted list"
      editor={editor}
      cardData={cardData}
      requirePrinting={false}
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
      <WantedListPage
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
        onCardIncrement={handleIncrement}
        onCardDecrement={handleDecrement}
        onCardContextMenu={handleContextMenu}
        unsavedChangeCount={editor.changes.changeCount()}
      />
    </EditorShell>
  )
}
