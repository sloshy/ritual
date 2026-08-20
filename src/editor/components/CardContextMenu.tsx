import { type Component, createMemo, Show } from 'solid-js'
import type { Finish, ScryfallCard } from '../../types'
import type { ListRef } from '../../change-event'
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
  const foilButtonDisabled = createMemo(() =>
    isFoilOrEtched() ? !supportsNonfoil() : !supportsFoil(),
  )

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
            class={`card-context-menu-item${foilButtonDisabled() ? ' card-context-menu-item--disabled' : ''}`}
            onClick={() => {
              if (!foilButtonDisabled()) setFoil()()
            }}
            disabled={foilButtonDisabled()}
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
