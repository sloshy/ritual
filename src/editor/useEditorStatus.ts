import { createStore } from 'solid-js/store'
import type { MessageKey } from '../i18n/messages/en'
import { paramsOf, type MessageRef, type TranslateArgs, type TranslateDynamicFn } from '../i18n/t'

/**
 * A status line the editor is holding on to, stored **unrendered**.
 *
 * A save banner or a load error can sit on screen for minutes; storing the
 * formatted string would freeze it in the language that was active when the
 * request came back, so a locale switch would relabel the whole page around a
 * stale sentence. Holding the key and its parameters instead lets the shell
 * re-render it in whatever locale is current (plan §7.4).
 *
 * The `text` variant carries prose the server authored (`ApiResult.message`),
 * which arrives already rendered. Phase 5 gives those responses a `messageKey`
 * as well, at which point this variant becomes the exception rather than the
 * common case.
 */
export type EditorStatusMessage = ({ kind: 'key' } & MessageRef) | { kind: 'text'; text: string }

/**
 * Build a {@link EditorStatusMessage} from a message key. Generic over the key
 * so the usual compile-time parameter checking applies at the producer, which is
 * the only place that knows which message it is emitting.
 */
export function statusMessage<K extends MessageKey>(
  key: K,
  ...args: TranslateArgs<K>
): EditorStatusMessage {
  return { kind: 'key', key, params: paramsOf(args) }
}

/** Wrap already-rendered prose (a server response) as a status message. */
export function statusText(text: string): EditorStatusMessage {
  return { kind: 'text', text }
}

/**
 * Render a stored status message with the caller's *dynamic* translator
 * (`useTDynamic()` in a component, so the text tracks the locale signal). The
 * key/params pair was checked by {@link statusMessage} while it still had the
 * literal key; `tDynamic` owns the erasure.
 */
export function renderStatus(t: TranslateDynamicFn, message: EditorStatusMessage): string {
  if (message.kind === 'text') return message.text
  return t(message.key, message.params)
}

export type EditorStatus = {
  loading: boolean
  error: EditorStatusMessage | null
  saving: boolean
  saveStatus: EditorStatusMessage | null
}

const initialStatus: EditorStatus = {
  loading: false,
  error: null,
  saving: false,
  saveStatus: null,
}

export type EditorStatusActions = {
  loadStart: () => void
  loadSuccess: () => void
  loadError: (error: EditorStatusMessage) => void
  saveStart: () => void
  saveSuccess: (message: EditorStatusMessage) => void
  saveError: (error: EditorStatusMessage) => void
  setError: (error: EditorStatusMessage) => void
}

export function useEditorStatus(): [EditorStatus, EditorStatusActions] {
  const [state, setState] = createStore<EditorStatus>({ ...initialStatus })

  const actions: EditorStatusActions = {
    loadStart: () => setState({ loading: true, error: null, saveStatus: null }),
    loadSuccess: () => setState({ loading: false }),
    loadError: (error) => setState({ loading: false, error }),
    // A new attempt invalidates the last one's error — including one raised
    // after a save landed (a failed custom-art write), which otherwise sits on
    // screen forever because nothing else clears `error`.
    saveStart: () => setState({ saving: true, error: null, saveStatus: null }),
    saveSuccess: (message) => setState({ saving: false, saveStatus: message }),
    saveError: (error) => setState({ saving: false, error }),
    setError: (error) => setState({ error }),
  }

  return [state, actions]
}
