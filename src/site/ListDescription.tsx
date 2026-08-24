/**
 * @module
 * A list's front-matter `description:` as the public site prints it — the one
 * renderer for all three list types, so a deck's blurb, a collection's and a
 * wanted list's are laid out, truncated and expanded identically.
 *
 * The text is plain prose rendered `white-space: pre-wrap` with mana symbols
 * substituted, never Markdown: that is the deck *primer*'s job, and a primer is
 * a deck-only field the deck page still renders beside this.
 */

import { createSignal, Show, type JSX } from 'solid-js'
import { useT } from '../ui/i18n'
import { SymbolText } from './symbols'

/** Longer than this many characters and the blurb starts collapsed. */
const COLLAPSE_THRESHOLD = 200

type ListDescriptionProps = {
  /** The list's description; nothing renders when it is absent or blank. */
  description?: string
  symbolMap: Record<string, string>
}

/**
 * The blurb, wrapped in its own `.list-description` block. Renders nothing
 * without a description, so a caller can mount it unconditionally — except on
 * the deck page, which groups it with the primer under one section wrapper.
 *
 * The `Show` is **keyed** so switching lists rebuilds the block: the admin
 * editors keep the page mounted across a list-selector change, and an inherited
 * `expanded` would show the next list's long blurb already expanded.
 */
export function ListDescription(props: ListDescriptionProps): JSX.Element {
  return (
    <Show when={props.description?.trim()} keyed>
      {(description) => (
        <div class="list-description">
          <Show
            when={description.length > COLLAPSE_THRESHOLD}
            fallback={
              <div class="text-preformatted">
                <SymbolText text={description} symbolMap={props.symbolMap} />
              </div>
            }
          >
            <ExpandableText text={description} symbolMap={props.symbolMap} />
          </Show>
        </div>
      )}
    </Show>
  )
}

/**
 * A list's description on its own, with the section spacing a page that has no
 * primer to group it with needs. The flat list pages' entry point.
 */
export function ListDescriptionSection(props: ListDescriptionProps): JSX.Element {
  // Gated here as well as inside `ListDescription` so a list with no blurb
  // keeps the spacing wrapper out of the DOM entirely.
  return (
    <Show when={props.description?.trim()}>
      <div class="list-description-section">
        <ListDescription description={props.description} symbolMap={props.symbolMap} />
      </div>
    </Show>
  )
}

/**
 * Cut `text` to at most `COLLAPSE_THRESHOLD` characters without splitting a
 * mana-symbol token: `SymbolText` matches `{...}` pairs, so a cut landing inside
 * one would render a literal `{W` that vanishes on expand. An unclosed brace in
 * the slice means the token straddles the cut, so the cut moves back to it.
 */
function truncateAtSymbolBoundary(text: string): string {
  const slice = text.slice(0, COLLAPSE_THRESHOLD)
  const lastOpen = slice.lastIndexOf('{')
  if (lastOpen === -1 || slice.indexOf('}', lastOpen) !== -1) return slice
  return slice.slice(0, lastOpen)
}

type ExpandableTextProps = {
  text: string
  symbolMap: Record<string, string>
}

/** A long blurb, collapsed to {@link COLLAPSE_THRESHOLD} characters until asked. */
function ExpandableText(props: ExpandableTextProps): JSX.Element {
  const t = useT()
  const [expanded, setExpanded] = createSignal(false)

  return (
    <div>
      <div class="text-preformatted">
        <SymbolText
          text={expanded() ? props.text : truncateAtSymbolBoundary(props.text) + '…'}
          symbolMap={props.symbolMap}
        />
      </div>
      <button
        type="button"
        class="link-action"
        aria-expanded={expanded()}
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded() ? t('site.list.showLess') : t('site.list.readMore')}
      </button>
    </div>
  )
}
