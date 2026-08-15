import type { Accessor } from 'solid-js'
import { isTypingTarget, useDocumentKeydown } from './useDocumentKeydown'

export type TypeToFilterOptions = {
  /**
   * Whether the capture is live (e.g. the owning dialog step is showing and
   * not covered by a notice). Defaults to always-on, gated by mounting.
   */
  active?: Accessor<boolean>
  /** The filter text being built up. */
  value: Accessor<string>
  setValue: (next: string) => void
  /**
   * The filter's own visible input. Its native editing already feeds `value`
   * through `onInput`, so keys landing there are left alone rather than being
   * applied twice.
   */
  inputEl: Accessor<HTMLInputElement | undefined>
}

/**
 * Type-to-filter without focus: while `active`, printable keys pressed anywhere
 * in the document append to a filter string, Backspace erases, and Escape
 * clears — mirroring the CLI's collector-mode "just start typing" affordance.
 *
 * The filter's text box stays a plain, never-auto-focused input: keys landing
 * in it are handled natively, keys landing anywhere else are routed here. Arrow
 * and Enter keys are deliberately not touched, so a grid or list keeps its own
 * keyboard navigation while a query is being typed. Note that Escape is
 * claimed from *any* focused text field while the filter is non-empty — fine
 * for the current consumers, but a dialog whose fields give Escape a meaning
 * of its own would need a carve-out here.
 *
 * The listener runs in the capture phase so that a consumed key reaches
 * nothing else: not the native `<dialog>` Escape-cancel (`preventDefault`),
 * and not a focused row's own Space handler (`stopPropagation` before the
 * event descends to the target).
 */
export function useTypeToFilter(options: TypeToFilterOptions): void {
  useDocumentKeydown(
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target
      const consume = () => {
        e.preventDefault()
        e.stopPropagation()
      }
      if (e.key === 'Escape') {
        if (options.value() === '') return
        // Clearing is this press's whole job — the dialog closes on the next one.
        consume()
        options.setValue('')
        return
      }
      if (target === options.inputEl()) return
      if (isTypingTarget(target)) return
      if (e.key === 'Backspace') {
        if (options.value() === '') return
        consume()
        options.setValue(options.value().slice(0, -1))
        return
      }
      if (e.key.length !== 1) return
      // With no query started, Space still belongs to whatever button holds
      // focus (and a leading space means nothing to the grammar anyway). Once
      // a query is in flight it is the grammar's set/number separator,
      // captured even from a focused row — `ds 12` must not activate the row.
      if (e.key === ' ' && options.value() === '') return
      consume()
      options.setValue(options.value() + e.key)
    },
    options.active ?? (() => true),
    { capture: true },
  )
}
