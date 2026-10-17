import { For, Show, type Component } from 'solid-js'
import { renderSyncMessage, type SyncMessageRef } from '../sync/message'
import { useI18n } from './i18n'

type SyncMessageLinesProps = {
  /** The messages, unrendered — worded here, in the reader's language. */
  messages: readonly SyncMessageRef[]
  /** Class of the wrapping live region. */
  class?: string
  /** Class of each message's paragraph. */
  lineClass?: string
}

/**
 * Advisory messages (a cart export's warnings) as one paragraph each, inside a
 * polite live region so a screen reader announces them when they appear.
 * Rendered in a tracked scope from the unrendered refs, so a locale switch
 * relabels lines already on screen. Renders nothing while `messages` is empty.
 */
export const SyncMessageLines: Component<SyncMessageLinesProps> = (props) => {
  const { locale } = useI18n()
  return (
    <Show when={props.messages.length > 0}>
      <div class={props.class} role="status" aria-live="polite">
        <For each={props.messages}>
          {(message) => <p class={props.lineClass}>{renderSyncMessage(message, locale())}</p>}
        </For>
      </div>
    </Show>
  )
}
