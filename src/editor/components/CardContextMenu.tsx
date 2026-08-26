import { type Component, createMemo, Show } from 'solid-js'
import type { Finish } from '../../card/finish-condition'
import type { ScryfallCard } from '../../scryfall/types'
import type { ListRef } from '../../changes/change-event'
import { useAnchoredMenu } from '../../ui/useAnchoredMenu'
import { useT } from '../../ui/i18n'
import { findPrintingsAvailable, openFindPrintings } from '../../site/find-printings'

const MENU_WIDTH = 180

/** Opening the printing picker for the targeted card, and how to label the row. */
type PrintingAction = {
  onSelect: () => void
  /** Whether the targeted line already pins a printing. */
  hasPrinting: boolean
}

interface CardContextMenuProps {
  cardName: string
  card: ScryfallCard | null
  anchorRect: DOMRect
  currentFinish?: Finish
  /** Toggle the card's foil finish. Absent on read-only pages, hiding the item. */
  onSetFoil?: () => void
  /**
   * The printing row. Absent on read-only pages, hiding the item. The flag and
   * the handler travel together so the row can never be labelled from a missing
   * flag: `hasPrinting` false means the line pins no printing yet, and the row
   * reads "Set Printing…" — there is nothing to change.
   */
  printingAction?: PrintingAction
  /**
   * Open the "Swap Printings" wizard on the targeted card alone. Shown only
   * when the line pins a printing ({@link PrintingAction.hasPrinting}): a
   * name-only line has no current printing to swap away from. Deck and
   * collection editors only — wanted lists hold no physical cards.
   */
  onSwapPrinting?: () => void
  onSetCommander?: () => void
  onUnsetCommander?: () => void
  onClose: () => void
  isCommander?: boolean
  hideCommander?: boolean
  /**
   * Open the label picker for the targeted card (every copy of the tile).
   * Collection editors only — labels are a collection concept.
   */
  onSetLabel?: () => void
  /**
   * Open the language picker for the targeted card (every copy of the tile).
   * Absent on read-only pages, hiding the item.
   */
  onSetLanguage?: () => void
  /**
   * Open the custom-art dialog for the targeted card. Admin editors only —
   * the write goes straight to the admin API, not through the change pipeline.
   */
  onSetCustomArt?: () => void
  /**
   * Open the move-to-section picker for the targeted card. Present whenever section
   * moves apply (the picker offers the other sections plus "New section…").
   */
  onMoveToSection?: () => void
  /** Other lists the targeted card can be moved into (excludes the current list). */
  moveTargets?: ListRef[]
  /**
   * Open the move-to-list picker for the targeted card (every copy of the tile).
   * Only shown when {@link moveTargets} is non-empty.
   */
  onMoveToList?: () => void
}

export const CardContextMenu: Component<CardContextMenuProps> = (props) => {
  const { setMenuRef, style } = useAnchoredMenu({
    anchorRect: () => props.anchorRect,
    width: MENU_WIDTH,
    onClose: () => props.onClose(),
  })

  const t = useT()

  const supportsFoil = createMemo(() => props.card?.finishes?.includes('foil') ?? false)
  const supportsNonfoil = createMemo(() => props.card?.finishes?.includes('nonfoil') ?? false)
  const isFoilOrEtched = createMemo(
    () => props.currentFinish === 'foil' || props.currentFinish === 'etched',
  )
  const foilButtonLabel = createMemo(() =>
    isFoilOrEtched() ? t('ui.cardMenu.setNonfoil') : t('ui.cardMenu.setFoil'),
  )
  /**
   * A finish belongs to a printing: a name-only line (the common deck and
   * wanted-list case) has no printing to be foil *of*, so the row is disabled
   * until one is set. Only the "Set as Foil" direction is gated — clearing an
   * existing `[foil]` token off a name-only line must stay reachable.
   */
  const needsPrinting = createMemo(() => {
    if (isFoilOrEtched()) return false
    const action = props.printingAction
    // Fails closed when the row is absent: the two props are independent in the
    // type, and an ungated foil row is the worse of the two wrong answers.
    return action === undefined || !action.hasPrinting
  })
  const foilButtonDisabled = createMemo(
    () => needsPrinting() || (isFoilOrEtched() ? !supportsNonfoil() : !supportsFoil()),
  )
  /** Why the row is dead, for the tooltip — every dead row explains itself. */
  const foilDisabledReason = createMemo(() => {
    if (needsPrinting()) return t('ui.cardMenu.foilNeedsPrinting')
    if (foilButtonDisabled()) return t('ui.cardMenu.finishUnavailable')
    return undefined
  })

  return (
    <div
      class="card-context-menu"
      ref={setMenuRef}
      style={style()}
      role="menu"
      aria-label={t('ui.cardMenu.options', { name: props.cardName })}
    >
      <Show when={props.onSetFoil}>
        {(setFoil) => (
          <button
            class="card-context-menu-item"
            onClick={() => {
              if (!foilButtonDisabled()) setFoil()()
            }}
            // `aria-disabled`, not `disabled`: Chromium and WebKit suppress
            // mouse events on a natively disabled control, which would hide the
            // `title` explaining why the row is dead — and keep it out of the
            // menu's tab order. The onClick guard above is what makes it inert.
            aria-disabled={foilButtonDisabled()}
            title={foilDisabledReason()}
          >
            {foilButtonLabel()}
          </button>
        )}
      </Show>
      <Show when={props.printingAction}>
        {(action) => (
          <button class="card-context-menu-item" onClick={() => action().onSelect()}>
            {action().hasPrinting ? t('ui.cardMenu.changePrinting') : t('ui.cardMenu.setPrinting')}
          </button>
        )}
      </Show>
      <Show when={props.onSwapPrinting}>
        {(swapPrinting) => (
          <button class="card-context-menu-item" onClick={() => swapPrinting()()}>
            {t('ui.cardMenu.swapPrinting')}
          </button>
        )}
      </Show>
      <Show when={props.onSetLabel}>
        {(setLabel) => (
          <button class="card-context-menu-item" onClick={() => setLabel()()}>
            {t('ui.cardMenu.setLabel')}
          </button>
        )}
      </Show>
      <Show when={props.onSetLanguage}>
        {(setLanguage) => (
          <button class="card-context-menu-item" onClick={() => setLanguage()()}>
            {t('ui.cardMenu.setLanguage')}
          </button>
        )}
      </Show>
      <Show when={props.onSetCustomArt}>
        {(setCustomArt) => (
          <button class="card-context-menu-item" onClick={() => setCustomArt()()}>
            {t('ui.cardMenu.setCustomArt')}
          </button>
        )}
      </Show>
      <Show when={!props.hideCommander}>
        <Show
          when={props.isCommander}
          fallback={
            <Show when={props.onSetCommander}>
              {(setCommander) => (
                <button class="card-context-menu-item" onClick={() => setCommander()()}>
                  {t('ui.cardMenu.setCommander')}
                </button>
              )}
            </Show>
          }
        >
          <Show when={props.onUnsetCommander}>
            {(unsetCommander) => (
              <button class="card-context-menu-item" onClick={() => unsetCommander()()}>
                {t('ui.cardMenu.unsetCommander')}
              </button>
            )}
          </Show>
        </Show>
      </Show>
      <Show when={props.onMoveToSection}>
        {(moveToSection) => (
          <button class="card-context-menu-item" onClick={() => moveToSection()()}>
            {t('ui.cardMenu.moveToSection')}
          </button>
        )}
      </Show>
      <Show when={props.onMoveToList && (props.moveTargets?.length ?? 0) > 0}>
        <button class="card-context-menu-item" onClick={() => props.onMoveToList!()}>
          {t('ui.cardMenu.moveToList')}
        </button>
      </Show>
      {/* Cross-list printing lookup; hidden where no FindPrintingsModal is
          mounted (the admin app). */}
      <Show when={findPrintingsAvailable()}>
        <button
          class="card-context-menu-item"
          onClick={() => {
            // Read the name before onClose unmounts the menu (and its props).
            const name = props.card?.name ?? props.cardName
            props.onClose()
            openFindPrintings(name)
          }}
        >
          {t('ui.cardMenu.findInLists')}
        </button>
      </Show>
    </div>
  )
}
