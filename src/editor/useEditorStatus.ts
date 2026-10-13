import { createStore } from 'solid-js/store'
import { saveSuccessSuffix, type SaveSuccessNotices } from './save-notices'
import type { MessageKey } from '../i18n/messages/en'
import { paramsOf, type MessageRef, type TranslateArgs, type TranslateDynamicFn } from '../i18n/t'

/**
 * A status line the editor is holding on to, stored **unrendered**.
 *
 * A save banner or a load error can sit on screen for minutes; storing the
 * formatted string would freeze it in the language that was active when the
 * request came back, so a locale switch would relabel the whole page around a
 * stale sentence. Holding the key and its parameters instead lets the shell
 * re-render it in whatever locale is current.
 *
 * The `text` variant carries prose that arrives already rendered: a server
 * response's English when it has no key this bundle knows. A save refusal that
 * carries a known `messageKey` is held by key instead (`saveEditorChanges`).
 */
export type EditorStatusMessage =
  ({ kind: 'key' } & MessageRef) | { kind: 'text'; text: string } | SavedWithNotices

/**
 * A save that had more to say than "saved" — held as the notices themselves, so
 * the dropped-note and pruned-category sentences relabel with the frame around
 * them on a language switch instead of freezing in the language they were
 * first rendered in.
 */
export type SavedWithNotices = { kind: 'saved'; notices: SaveSuccessNotices }

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
  switch (message.kind) {
    case 'text':
      return message.text
    case 'key':
      return t(message.key, message.params)
    case 'saved': {
      // The notices render through the module translator, which reads the same
      // locale signal, so they track the switch the frame does.
      const notes = saveSuccessSuffix(message.notices)
      return notes ? t('ui.editor.saveSuccessNotices', { notes }) : t('ui.editor.saveSuccess')
    }
  }
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
