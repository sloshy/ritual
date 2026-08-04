import { type Component, createMemo, Show } from 'solid-js'
import type { Finish, ScryfallCard } from '../../types'
import type { ListRef } from '../../change-event'
import { useAnchoredMenu } from '../../ui/useAnchoredMenu'
import { findPrintingsAvailable, openFindPrintings } from '../../site/find-printings'

const MENU_WIDTH = 180

interface CardContextMenuProps {
  cardName: string
  card: ScryfallCard | null
  anchorRect: DOMRect
  currentFinish?: Finish
  /** Toggle the card's foil finish. Absent on read-only pages, hiding the item. */
  onSetFoil?: () => void
  onChangePrinting?: () => void
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

  const supportsFoil = createMemo(() => props.card?.finishes?.includes('foil') ?? false)
  const supportsNonfoil = createMemo(() => props.card?.finishes?.includes('nonfoil') ?? false)
  const isFoilOrEtched = createMemo(
    () => props.currentFinish === 'foil' || props.currentFinish === 'etched',
  )
  const foilButtonLabel = createMemo(() => (isFoilOrEtched() ? 'Set as Nonfoil' : 'Set as Foil'))
  const foilButtonDisabled = createMemo(() =>
    isFoilOrEtched() ? !supportsNonfoil() : !supportsFoil(),
  )

  return (
    <div
      class="card-context-menu"
      ref={setMenuRef}
      style={style()}
      role="menu"
      aria-label={`Options for ${props.cardName}`}
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
      <Show when={props.onChangePrinting}>
        {(changePrinting) => (
          <button class="card-context-menu-item" onClick={() => changePrinting()()}>
            Change Printing…
          </button>
        )}
      </Show>
      <Show when={props.onSetLabel}>
        {(setLabel) => (
          <button class="card-context-menu-item" onClick={() => setLabel()()}>
            Set Label…
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
                  Set as Commander
                </button>
              )}
            </Show>
          }
        >
          <Show when={props.onUnsetCommander}>
            {(unsetCommander) => (
              <button class="card-context-menu-item" onClick={() => unsetCommander()()}>
                Unset as Commander
              </button>
            )}
          </Show>
        </Show>
      </Show>
      <Show when={props.onMoveToSection}>
        {(moveToSection) => (
          <button class="card-context-menu-item" onClick={() => moveToSection()()}>
            Move to section…
          </button>
        )}
      </Show>
      <Show when={props.onMoveToList && (props.moveTargets?.length ?? 0) > 0}>
        <button class="card-context-menu-item" onClick={() => props.onMoveToList!()}>
          Move to list…
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
          Find in Lists
        </button>
      </Show>
    </div>
  )
}
