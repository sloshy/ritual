import type { JSX } from '@solidjs/web'
import { For, Show } from 'solid-js'
import type { MessageSegment } from '../i18n/types'

type LinkedMessageProps = {
  /** The rendered message, from `tSegments`. Pass the call itself so a locale change re-renders it. */
  segments: MessageSegment[]
  /** The parameters that are links, by name; any other parameter renders as text. */
  hrefs: Readonly<Record<string, string | undefined>>
}

/**
 * A translated message whose parameters are links to other sites. Segments,
 * not concatenation: a link sits mid-sentence and a translator must be free to
 * move it. A component rather than a helper so its props stay getters, which
 * `<For>` reads inside its own tracked scope wherever this is placed. Links
 * open in a new tab, so following one never discards in-page state such as an
 * unsaved edit session.
 */
export function LinkedMessage(props: LinkedMessageProps): JSX.Element {
  return (
    <For each={props.segments}>
      {(segment) => (
        <Show
          when={segment.kind === 'param' ? props.hrefs[segment.name] : undefined}
          fallback={segment.value}
        >
          {(href) => (
            <a href={href()} target="_blank" rel="noopener noreferrer">
              {segment.value}
            </a>
          )}
        </Show>
      )}
    </For>
  )
}
