import { For, Show, type Component } from 'solid-js'
import { useT, useTSegments } from '../../../ui/i18n'
import type { SearchSourceNote } from '../../search-provider'

export type SearchStepProps = {
  query: string
  results: string[]
  highlightedIndex: number
  sourceNote: SearchSourceNote | undefined
  /** The search input, owned by the dialog (it focuses it on open). */
  inputRef: (el: HTMLInputElement) => void
  onInput: (value: string) => void
  onKeyDown: (e: KeyboardEvent) => void
  onPick: (name: string) => void
  onHover: (name: string, index: number) => void
  onLeave: () => void
}

/** Step 1: the autocomplete search. */
export const SearchStep: Component<SearchStepProps> = (props) => {
  const t = useT()
  const tSegments = useTSegments()
  return (
    <>
      <div class="search-modal-header">
        <input
          ref={props.inputRef}
          type="text"
          placeholder={t('ui.addCard.searchPlaceholder')}
          value={props.query}
          onInput={(e) => props.onInput(e.currentTarget.value)}
          onKeyDown={props.onKeyDown}
        />
      </div>
      <Show when={props.sourceNote}>
        {(note) => (
          <p class="search-source-note">
            <For each={note().segments(tSegments)}>
              {(segment) =>
                segment.kind === 'param' ? (
                  <a href={note().linkUrl} target="_blank" rel="noopener noreferrer">
                    {segment.value}
                  </a>
                ) : (
                  segment.value
                )
              }
            </For>
          </p>
        )}
      </Show>
      <div class="search-modal-body" onMouseLeave={props.onLeave}>
        <For each={props.results}>
          {(name, i) => (
            <button
              class={`search-result-item${i() === props.highlightedIndex ? ' search-result-item--highlighted' : ''}`}
              onClick={() => props.onPick(name)}
              onMouseEnter={() => props.onHover(name, i())}
            >
              {name}
            </button>
          )}
        </For>
      </div>
    </>
  )
}
