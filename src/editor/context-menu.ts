import type { CardContextInfo } from '../site/card-context'

export type { CardContextInfo }

export type ContextMenuState = CardContextInfo & {
  anchorRect: DOMRect
}
