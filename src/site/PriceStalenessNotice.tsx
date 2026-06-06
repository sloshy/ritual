import { type Component, Show, For, createSignal } from 'solid-js'

type PriceStalenessNoticeProps = {
  /** Names of cards whose prices predate the freshest in the list. */
  outdatedNames: string[]
}

/**
 * Small, expandable warning shown on a list page when card prices have mixed dates —
 * e.g. after "Update Prices" refreshed some cards but others stayed at the build-time
 * price. Collapsed by default; expands to name the cards with the older prices.
 */
export const PriceStalenessNotice: Component<PriceStalenessNoticeProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const count = () => props.outdatedNames.length

  return (
    <Show when={count() > 0}>
      <div class="price-staleness">
        <button
          type="button"
          class="price-staleness-toggle"
          aria-expanded={open()}
          onClick={() => setOpen((o) => !o)}
        >
          <span class="price-staleness-icon" aria-hidden="true">
            ⚠
          </span>
          <span>
            {count()} {count() === 1 ? 'card has' : 'cards have'} an older price than the rest
          </span>
          <span class="price-staleness-caret" aria-hidden="true">
            {open() ? '▾' : '▸'}
          </span>
        </button>
        <Show when={open()}>
          <ul class="price-staleness-list">
            <For each={props.outdatedNames}>{(name) => <li>{name}</li>}</For>
          </ul>
        </Show>
      </div>
    </Show>
  )
}
