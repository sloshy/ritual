import type { Component } from 'solid-js'
import { useTypeToFilter } from './useTypeToFilter'
import { useT } from './i18n'

export type PrintingFilterProps = {
  /** The query text; the caller owns it and derives its filtered list from it. */
  value: string
  onChange: (next: string) => void
  /**
   * Whether the type-anywhere capture is live. Defaults to true — mounting the
   * component is the gate — so pass this only when the picker can be covered
   * by another step or notice while still mounted.
   */
  active?: boolean
}

/**
 * The collector-query box shared by the printing pickers: a never-auto-focused
 * input whose text also builds from printable keys pressed anywhere in the
 * dialog (see {@link useTypeToFilter}), so keyboard users filter by just
 * typing while the box itself stays a tap target for on-screen keyboards.
 * Callers pair it with `filterPrintingsByQuery` from `src/collector-query.ts`
 * and an `.empty-state` no-match message keyed `ui.printingFilter.noMatches`.
 */
export const PrintingFilter: Component<PrintingFilterProps> = (props) => {
  const t = useT()
  let inputRef: HTMLInputElement | undefined
  useTypeToFilter({
    active: () => props.active !== false,
    value: () => props.value,
    setValue: (next) => props.onChange(next),
    inputEl: () => inputRef,
  })
  return (
    <div class="printing-filter-row">
      <input
        ref={inputRef}
        type="text"
        class="printing-filter"
        placeholder={t('ui.printingFilter.placeholder')}
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
        autocomplete="off"
      />
    </div>
  )
}
