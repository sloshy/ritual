import { type Component, For } from 'solid-js'
import { createMemo, Show } from 'solid-js'
import type { Finish, ScryfallCard } from '../../types'
import { useAnchoredMenu } from '../../ui/useAnchoredMenu'

const MENU_WIDTH = 180

interface CardContextMenuProps {
  cardName: string
  card: ScryfallCard | null
  anchorRect: DOMRect
  currentFinish?: Finish
  onSetFoil: () => void
  onChangePrinting?: () => void
  onSetCommander?: () => void
  onUnsetCommander: () => void
  onClose: () => void
  isCommander?: boolean
  hideCommander?: boolean
  /** All section names; the card's current section is omitted from the move targets. */
  sections?: string[]
  /** The section the targeted card currently belongs to. */
  currentSection?: string
  /** Move the targeted card to an existing section. */
  onMoveToSection?: (section: string) => void
  /** Open a styled prompt to name a new section and move the targeted card into it. */
  onCreateSection?: () => void
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

  // Move targets are every section except the one the card already lives in.
  const moveTargets = createMemo(() =>
    (props.sections ?? []).filter((s) => s !== props.currentSection),
  )

  return (
    <div
      class="card-context-menu"
      ref={setMenuRef}
      style={style()}
      role="menu"
      aria-label={`Options for ${props.cardName}`}
    >
      <button
        class={`card-context-menu-item${foilButtonDisabled() ? ' card-context-menu-item--disabled' : ''}`}
        onClick={() => {
          if (!foilButtonDisabled()) props.onSetFoil()
        }}
        disabled={foilButtonDisabled()}
      >
        {foilButtonLabel()}
      </button>
      <Show when={props.onChangePrinting}>
        {(changePrinting) => (
          <button class="card-context-menu-item" onClick={() => changePrinting()()}>
            Change Printing…
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
          <button class="card-context-menu-item" onClick={props.onUnsetCommander}>
            Unset as Commander
          </button>
        </Show>
      </Show>
      <Show when={props.onMoveToSection}>
        {(moveToSection) => (
          <>
            <div class="card-context-menu-label">Move to section</div>
            <For each={moveTargets()}>
              {(section) => (
                <button
                  class="card-context-menu-item card-context-menu-item--indented"
                  onClick={() => moveToSection()(section)}
                >
                  {section}
                </button>
              )}
            </For>
            <Show when={props.onCreateSection}>
              {(createSection) => (
                <button
                  class="card-context-menu-item card-context-menu-item--indented"
                  onClick={() => createSection()()}
                >
                  New section…
                </button>
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}
