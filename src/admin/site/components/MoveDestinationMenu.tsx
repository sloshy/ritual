import { type Component, For, Show, createMemo } from 'solid-js'
import type { ListInfo } from '../../../list/list-info'
import { groupListsByType } from '../list-grouping'
import { useT, useTKey } from '../../../ui/i18n'
import { useAnchoredMenu } from '../../../ui/useAnchoredMenu'

const MENU_WIDTH = 220

interface MoveDestinationMenuProps {
  cardName: string
  anchorRect: DOMRect
  /** Eligible destinations, already filtered (destination filter applied, current list excluded). */
  destinations: ListInfo[]
  onSelect: (dest: ListInfo) => void
  onClose: () => void
}

/**
 * The "Move To…" popup opened from a card's move button. Lists every eligible
 * destination grouped by list type, reusing the card context menu's chrome and
 * the shared anchored-menu positioning.
 */
export const MoveDestinationMenu: Component<MoveDestinationMenuProps> = (props) => {
  const t = useT()
  const tKey = useTKey()
  const { setMenuRef, style } = useAnchoredMenu({
    anchorRect: () => props.anchorRect,
    width: MENU_WIDTH,
    onClose: () => props.onClose(),
  })

  const grouped = createMemo(() => groupListsByType(props.destinations))

  return (
    <div
      class="card-context-menu move-destination-menu"
      ref={setMenuRef}
      style={style()}
      role="menu"
      aria-label={t('admin.moveMenu.label', { name: props.cardName })}
    >
      <Show
        when={props.destinations.length > 0}
        fallback={<div class="card-context-menu-empty">{t('admin.moveMenu.empty')}</div>}
      >
        <For each={grouped()}>
          {(group) => (
            <>
              <div class="card-context-menu-label">{tKey(group.labelKey)}</div>
              <For each={group.lists}>
                {(dest) => (
                  <button
                    class="card-context-menu-item card-context-menu-item--indented"
                    onClick={() => props.onSelect(dest)}
                  >
                    {dest.name}
                  </button>
                )}
              </For>
            </>
          )}
        </For>
      </Show>
    </div>
  )
}
