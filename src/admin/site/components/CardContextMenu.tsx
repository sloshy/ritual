import { type Component, type JSX, For } from 'solid-js'
import { createMemo, createSignal, onMount, onCleanup, Show } from 'solid-js'
import type { Finish, ScryfallCard } from '../../../types'

const MENU_WIDTH = 180
const MENU_OFFSET = 4
// Keep the menu this far from the viewport edges when it has to be clamped/scrolled.
const VIEWPORT_MARGIN = 8

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
  /** Move the targeted card to an existing or brand-new section. */
  onMoveToSection?: (section: string) => void
}

export const CardContextMenu: Component<CardContextMenuProps> = (props) => {
  let menuRef: HTMLDivElement | undefined
  // Measured after mount so positioning uses the menu's real height (it varies with the number
  // of sections in the move list) rather than a fixed estimate that overflowed the viewport.
  const [menuHeight, setMenuHeight] = createSignal(0)

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

  const menuStyle = createMemo((): JSX.CSSProperties => {
    const anchor = props.anchorRect
    const viewportH = window.innerHeight
    const viewportW = window.innerWidth
    const height = menuHeight()
    const spaceBelow = viewportH - anchor.bottom - MENU_OFFSET
    const spaceAbove = anchor.top - MENU_OFFSET

    let top: number
    let maxHeight: number | undefined
    if (height === 0 || height <= spaceBelow) {
      // Fits below (or not yet measured — provisional, corrected on mount).
      top = anchor.bottom + MENU_OFFSET
    } else if (height <= spaceAbove) {
      // Doesn't fit below but fits above: flip up.
      top = anchor.top - height - MENU_OFFSET
    } else {
      // Taller than either gap: anchor to the roomier side and scroll the overflow so every
      // option stays reachable instead of running off-screen.
      const useBelow = spaceBelow >= spaceAbove
      maxHeight = (useBelow ? spaceBelow : spaceAbove) - VIEWPORT_MARGIN
      top = useBelow ? anchor.bottom + MENU_OFFSET : anchor.top - MENU_OFFSET - maxHeight
    }

    const left = Math.min(anchor.right - MENU_WIDTH, viewportW - MENU_WIDTH - VIEWPORT_MARGIN)
    const style: JSX.CSSProperties = {
      position: 'fixed',
      top: `${top}px`,
      left: `${Math.max(left, VIEWPORT_MARGIN)}px`,
    }
    if (maxHeight !== undefined) {
      style['max-height'] = `${maxHeight}px`
      style['overflow-y'] = 'auto'
    }
    return style
  })

  onMount(() => {
    // Measure the rendered menu so `menuStyle` can place/clamp it against the viewport.
    if (menuRef) setMenuHeight(menuRef.getBoundingClientRect().height)

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) {
        props.onClose()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    onCleanup(() => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    })
  })

  return (
    <div
      class="card-context-menu"
      ref={menuRef}
      style={menuStyle()}
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
            <button
              class="card-context-menu-item card-context-menu-item--indented"
              onClick={() => {
                const name = window.prompt('New section name:')
                if (name && name.trim()) moveToSection()(name.trim())
              }}
            >
              New section…
            </button>
          </>
        )}
      </Show>
    </div>
  )
}
