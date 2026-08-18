import { type Accessor, type JSX, Show, createEffect, createSignal, onCleanup } from 'solid-js'
import { Portal } from 'solid-js/web'

/** How long a message stays fully opaque before it starts fading out. */
const VISIBLE_MS = 5000
/**
 * Length of the fade-out. Published to CSS as `--toast-fade-ms` (see `.toast` in
 * controls.css) so the transition and the timer that unmounts the node after it
 * cannot drift apart.
 */
const FADE_MS = 400

/** Which alert chrome a message wears, and how it is announced. */
type ToastTone = 'status' | 'error'

const TONE_CLASS = {
  status: 'alert alert-success toast',
  error: 'alert alert-error toast',
} as const satisfies Record<ToastTone, string>

/** A failure interrupts; a success waits its turn. */
const TONE_ROLE = {
  status: 'status',
  error: 'alert',
} as const satisfies Record<ToastTone, string>

/** A message on screen, and whether it is in its fade-out. */
type FadingMessage<TMessage> = { value: TMessage; leaving: boolean }

export type StatusToastProps<TMessage> = {
  /** Success message, e.g. the result of a save. `null` when there is nothing to report. */
  status: TMessage | null
  /** Failure message. */
  error: TMessage | null
  /**
   * Renders a message for display. Called from JSX, so a locale-aware renderer
   * relabels a visible toast without re-arming its timer — the timer is keyed on
   * the message *value*, which is what "a new thing happened" actually means.
   */
  render: (message: TMessage) => string
}

/**
 * Mirror a message as a self-expiring one: it appears when the source becomes
 * non-null, fades after {@link VISIBLE_MS}, and is dropped once the fade has run.
 * A fresh message while one is on screen restarts the clock, so the newest result
 * always gets its full five seconds.
 */
function useFadingMessage<TMessage>(
  source: Accessor<TMessage | null>,
): Accessor<FadingMessage<TMessage> | null> {
  const [current, setCurrent] = createSignal<FadingMessage<TMessage> | null>(null)
  let fadeTimer: ReturnType<typeof setTimeout> | undefined
  let dropTimer: ReturnType<typeof setTimeout> | undefined

  const stopTimers = (): void => {
    clearTimeout(fadeTimer)
    clearTimeout(dropTimer)
  }

  createEffect(() => {
    const value = source()
    stopTimers()
    if (value === null) {
      setCurrent(null)
      return
    }
    setCurrent({ value, leaving: false })
    fadeTimer = setTimeout(() => {
      setCurrent((prev) => (prev === null ? null : { ...prev, leaving: true }))
      dropTimer = setTimeout(() => setCurrent(null), FADE_MS)
    }, VISIBLE_MS)
  })

  onCleanup(stopTimers)
  return current
}

/**
 * The floating counterpart of the `.alert` banner: the same success/error chrome,
 * but pinned to the top of the *window* rather than the top of the page, and gone
 * again five seconds later.
 *
 * A banner in the document flow is invisible to anyone who has scrolled down a
 * long list — which is exactly when a save result matters. The stack is portalled
 * to `document.body` so no transformed ancestor can capture its `position: fixed`,
 * and sits below whatever chrome is stuck to the top of the viewport (see
 * `.toast-stack` in controls.css).
 *
 * Both channels expire, errors included: a message that outlives its context is
 * the failure mode the in-flow banner already had (an error from one list sitting
 * over the next one). Nothing is lost silently — a failed save leaves its changes
 * pending, so the state itself still says the write did not land.
 */
export function StatusToast<TMessage>(props: StatusToastProps<TMessage>): JSX.Element {
  const status = useFadingMessage(() => props.status)
  const error = useFadingMessage(() => props.error)

  const toast = (
    tone: ToastTone,
    message: Accessor<FadingMessage<TMessage> | null>,
  ): JSX.Element => (
    <Show when={message()}>
      {(current) => (
        <div
          class={TONE_CLASS[tone]}
          classList={{ 'toast--leaving': current().leaving }}
          role={TONE_ROLE[tone]}
        >
          {props.render(current().value)}
        </div>
      )}
    </Show>
  )

  return (
    <Portal>
      <div class="toast-stack" style={{ '--toast-fade-ms': `${FADE_MS}ms` }}>
        {toast('status', status)}
        {toast('error', error)}
      </div>
    </Portal>
  )
}
