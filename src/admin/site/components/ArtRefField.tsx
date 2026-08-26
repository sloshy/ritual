import { type Accessor, type Component, createMemo, createSignal, Show } from 'solid-js'
import { useT } from '../../../ui/i18n'
import { isCardArtRefError, parseCardArtRef, type CardArtRef } from '../../../list/card-art'
import { cardArtDisplayUrl } from '../../../list/art-url'
import { useDebouncedInput, type DebouncedInput } from '../../../site/useDebouncedInput'

/**
 * The one text field that names an image by reference: a path inside the art
 * directory, or a URL on the web.
 *
 * Both dialogs that point something at an image are built on it — a card's
 * custom art ({@link CardArtModal}) and a list's cover image
 * ({@link ListImageModal}) — so the grammar they accept, the moment they refuse
 * it, the debounced preview and the "that image could not be loaded" line are
 * written once. Neither the radio group above the field nor the dialog's buttons
 * live here: the cover dialog offers four modes where the art dialog offers two,
 * and only the field itself is common to them.
 */

/** Which half of the art grammar the typed value is read as. */
export type CardArtMode = 'file' | 'url'

/**
 * How long the field waits before the preview follows it. Longer than the
 * filter inputs' default: each commit here is a network fetch for an image,
 * not a re-filter of already-loaded cards.
 */
const ART_PREVIEW_DEBOUNCE_MS = 500

/**
 * The typed value read as a reference: nothing yet, the reference itself, or the
 * parser's refusal.
 */
export type CardArtInput =
  | { state: 'empty' }
  | { state: 'valid'; art: CardArtRef }
  | { state: 'invalid'; reason: string }

/**
 * Read one form value as an art reference, through the same grammar the sidecar,
 * the art route and the CLI go through — the mode picks which half of it applies,
 * since a bare `sol-ring.png` is a legitimate path and never a URL.
 *
 * The dialog cannot rely on the route to catch a bad value: a card this session
 * added is staged locally and only reaches the server after the save that writes
 * its line, where a refusal arrives long after the modal is gone.
 */
export function readCardArtValue(mode: CardArtMode, raw: string): CardArtInput {
  const trimmed = raw.trim()
  if (trimmed === '') return { state: 'empty' }
  const parsed = parseCardArtRef(mode === 'file' ? { file: trimmed } : { url: trimmed })
  if (isCardArtRefError(parsed)) return { state: 'invalid', reason: parsed.error }
  return { state: 'valid', art: parsed }
}

/** One art-reference field's state: what is typed, what it parses to, what it previews. */
export type ArtRefFieldState = {
  /** Bind to the input element: instant draft, debounced commit. */
  input: DebouncedInput
  /**
   * The *draft* read through the grammar. Drives the refusal line and the
   * dialog's Save button, so a value the parser rejects is reported as it is
   * typed rather than a debounce later.
   */
  parsed: Accessor<CardArtInput>
  /**
   * The preview's `src`, from the *committed* value — null while the value is
   * empty or unusable, since pointing an `<img>` at a refused value would answer
   * "that image could not be loaded" to a question the field has already
   * answered more precisely.
   */
  previewUrl: Accessor<string | null>
  /** Replace the field's contents outright (e.g. reseeding on a mode switch). */
  set: (value: string) => void
}

/**
 * Create the state one {@link ArtRefField} needs. `mode` is an accessor because
 * the radio group that picks it lives in the dialog above the field: switching
 * it re-reads the same text through the other half of the grammar, which is what
 * turns a typo'd URL into a refusal without the user retyping anything.
 */
export function createArtRefField(mode: Accessor<CardArtMode>, initial: string): ArtRefFieldState {
  const [value, setValue] = createSignal(initial)
  // The field commits on a pause, not per keystroke: the preview points an
  // `<img>` at whatever is typed, and an uncommitted draft would fire a request
  // for every prefix of a path or URL. Saving reads the draft, so a click
  // straight after typing still writes what is on screen.
  const input = useDebouncedInput(value, setValue, ART_PREVIEW_DEBOUNCE_MS)
  const parsed = createMemo<CardArtInput>(() => readCardArtValue(mode(), input.draft()))
  const previewUrl = createMemo(() => {
    const committed = readCardArtValue(mode(), value())
    return committed.state === 'valid' ? cardArtDisplayUrl(committed.art) : null
  })
  return { input, parsed, previewUrl, set: (next) => input.commit(next) }
}

type ArtRefFieldProps = {
  /** The field's state, from {@link createArtRefField}. */
  field: ArtRefFieldState
  /** Which half of the grammar the value is read as; picks the label and placeholder. */
  mode: CardArtMode
  /** DOM id for the input; the refusal line's id is derived from it. */
  inputId: string
  /** Alt text for the preview image — each dialog names its own subject. */
  previewAlt: string
  /** Frame for the parser's untranslated refusal, worded by the owning dialog. */
  invalidMessage: (reason: string) => string
}

/**
 * The labelled text field, its refusal line and its live preview. Purely
 * presentational over an {@link ArtRefFieldState}: the dialog owns the mode, the
 * buttons and what the accepted reference is finally written to.
 */
export const ArtRefField: Component<ArtRefFieldProps> = (props) => {
  const t = useT()
  // The exact URL whose preview failed, not a flag: the field is edited
  // character by character, and a flag would keep flagging the value that fixed
  // it until something else cleared it.
  const [brokenUrl, setBrokenUrl] = createSignal<string | null>(null)
  const noteId = (): string => `${props.inputId}-note`
  const refError = (): string | null => {
    const parsed = props.field.parsed()
    return parsed.state === 'invalid' ? parsed.reason : null
  }

  return (
    <>
      <div class="text-prompt-field">
        <label class="text-prompt-label" for={props.inputId}>
          {props.mode === 'file' ? t('admin.art.fileLabel') : t('admin.art.urlLabel')}
        </label>
        <input
          id={props.inputId}
          type="text"
          class={`form-input${refError() !== null ? ' form-input--invalid' : ''}`}
          value={props.field.input.draft()}
          placeholder={
            props.mode === 'file' ? t('admin.art.filePlaceholder') : t('admin.art.urlPlaceholder')
          }
          aria-invalid={refError() !== null}
          aria-describedby={refError() !== null ? noteId() : undefined}
          onInput={(e) => props.field.input.onInput(e.currentTarget.value)}
          onBlur={() => props.field.input.flush()}
        />
      </div>
      <Show when={refError()}>
        {(reason) => (
          // The reason is engine prose — the same sentence the art route and the
          // CLI report — framed by a translated wrapper.
          <p id={noteId()} class="form-error">
            {props.invalidMessage(reason())}
          </p>
        )}
      </Show>
      <Show when={props.field.previewUrl()}>
        {(url) => (
          <div class="card-art-preview">
            <img src={url()} alt={props.previewAlt} onError={() => setBrokenUrl(url())} />
          </div>
        )}
      </Show>
      <Show when={brokenUrl() !== null && brokenUrl() === props.field.previewUrl()}>
        <p class="form-error">{t('admin.art.previewFailed')}</p>
      </Show>
    </>
  )
}
