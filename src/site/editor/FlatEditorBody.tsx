import { createMemo, type Accessor, type JSX } from 'solid-js'
import { withEntryArt, type CardArtRefs } from '../../editor/card-art-view'
import type { EditorEntity } from '../../editor/entity'
import {
  FlatListEditorShell,
  type FlatEntry,
  type FlatListController,
  type FlatListEditorShellProps,
} from '../../editor/flat-list-controller'
import type { SearchProvider } from '../../editor/search-provider'
import type { UseEditorDefaultsResult } from '../../editor/useEditorDefaults'
import type { CardContextInfo } from '../../list-view/card-context'
import type { NamedListRef } from '../../list-view/combined-list'
import type { SellModeProps } from '../../list-view/sell-mode'
import type { ListType } from '../../list/list-type'
import type { PriceCurrency } from '../../pricing/price-currency'

/** The four literals that make the shared shell a collection's or a wanted list's. */
export type FlatEditorShellConfig = {
  entityLabel: EditorEntity
  selectorId: string
  /** Whether adding a card must pin a printing (collections yes, wanted lists no). */
  requirePrinting: boolean
  importKind: ListType
}

/**
 * The props the collection and wanted-list editor bodies take identically. Every
 * one is either the controller's own wiring or a value forwarded straight to the
 * page underneath.
 */
export type FlatEditorBodyCommonProps<E extends FlatEntry> = SellModeProps & {
  ctrl: FlatListController<E>
  defaults: UseEditorDefaultsResult
  search: SearchProvider
  currency: PriceCurrency
  useScryfallImgUrls: boolean
  /** Display name for the list page header. */
  name: string
  /** Forwarded to the page: the list's front-matter blurb. */
  description?: string
  showSave?: boolean
  showDiscard?: boolean
  enableImport?: boolean
  /** Forwarded to the page: the public editor keeps the centered container width. */
  fullWidth?: boolean
  /** Forwarded to the page: show the public "Update Prices" toolbar button + staleness. */
  enablePriceRefresh?: boolean
  /** Forwarded to the page: offer "Add to Trade" in the multi-select menu (public site only). */
  enableTrade?: boolean
  /** The list's custom art, resolved onto the entries the page renders. */
  customArt?: CardArtRefs
  /** Open the custom-art dialog for a card (admin editor only — needs the authed art route). */
  onSetCustomArt?: (target: CardContextInfo) => void
  /** Open the cover-image editor (admin editor only — needs the authed metadata route). */
  onEditImage?: () => void
  /** Every list, for the toolbar's share filters (the page drops itself). */
  shareLists?: readonly NamedListRef[]
}

/**
 * The collection-only affordances, `Pick`ed off the shell they are forwarded to
 * so the spread below is *checked*: a renamed shell prop is a compile error here
 * instead of a silently dropped callback.
 */
type FlatEditorShellPassThrough<E extends FlatEntry> = Pick<
  FlatListEditorShellProps<E>,
  'onEditLabels' | 'swap' | 'onSwapPrintings' | 'onSwapPrinting' | 'onSetLabel'
>

export type FlatEditorBodyProps<E extends FlatEntry> = FlatEditorBodyCommonProps<E> &
  FlatEditorShellPassThrough<E> & {
    shell: FlatEditorShellConfig
    /** The list page. A render callback: the entries accessor is created here. */
    page: (entries: Accessor<E[]>) => JSX.Element
  }

/**
 * Editor chrome shared by the flat-list editors: the {@link FlatListEditorShell}
 * wrapping the caller's list page in edit mode. Collections and wanted lists
 * differ only in the {@link FlatEditorShellConfig} literals, the collection-only
 * label/swap affordances, and the page they render.
 */
export function FlatEditorBody<E extends FlatEntry>(props: FlatEditorBodyProps<E>): JSX.Element {
  // Every shell prop this body forwards carries the shell's own name, so the two
  // spreads say it once; props the shell does not name are simply not read.
  return (
    <FlatListEditorShell {...props} {...props.shell}>
      {(entries) => {
        // Memoized: the projection clones every entry on a list that has art,
        // and the page prop is read on each of the editor's frequent re-renders.
        const entriesWithArt = createMemo(() => withEntryArt(entries(), props.customArt))
        return props.page(entriesWithArt)
      }}
    </FlatListEditorShell>
  )
}
