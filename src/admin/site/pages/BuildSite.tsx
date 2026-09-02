import { type JSX, batch, createEffect, createSignal, onCleanup, Show, For } from 'solid-js'
import { useT } from '../../../ui/i18n'
import { apiMessage } from '../../../api/result'
import type { ApiMessage } from '../../../api/result'
import type { BuildSiteDoneEvent, BuildSiteStreamEvent } from '../../api/build-site'
import { useApiAction } from '../hooks/useApiAction'
import { StatusAlerts } from '../components/StatusAlerts'
import { PageHeading } from '../components/PageHeading'
import { openSyncStream, type SyncStream } from '../sync-stream'

/**
 * The names of the build stream's structural steps, by their `progress` value.
 * Labels only — the scale itself (`total`) comes off each frame.
 */
const STEP_NAMES = ['starting', 'building', 'publishing', 'done'] as const

type StepName = (typeof STEP_NAMES)[number]

/** Where the build is on the stream's own scale. */
type BuildStep = { progress: number; total: number }

/**
 * How many output lines the page keeps. A build prints thousands; the box is
 * for watching it go, not for reading it back, so only the tail is held.
 */
const OUTPUT_TAIL_LINES = 200

/** The name of a step from its position on the scale. */
function stepName(step: BuildStep): StepName {
  const index = Math.round(step.progress)
  return STEP_NAMES[Math.max(0, Math.min(STEP_NAMES.length - 1, index))]!
}

export function BuildSite(): JSX.Element {
  const t = useT()
  // The alerts and the plain-POST fallback: `run` is what a page without a
  // working event stream falls back to, and `setStatus`/`setError` are how the
  // streamed run reports through the same alerts.
  const { status, error, loading, run, setStatus, setError } = useApiAction()

  const [streaming, setStreaming] = createSignal(false)
  const [step, setStep] = createSignal<BuildStep | null>(null)
  const [output, setOutput] = createSignal<string[]>([])

  let stream: SyncStream | null = null
  onCleanup(() => stream?.close())

  // Output arrives one frame per line, far faster than anyone reads; lines are
  // coalesced into one signal write per paint so a chatty build does not drive
  // a full reconcile of the log box per line.
  let pendingLines: string[] = []
  let flushHandle: number | null = null
  const appendLine = (line: string): void => {
    pendingLines.push(line)
    if (flushHandle !== null) return
    flushHandle = requestAnimationFrame(() => {
      flushHandle = null
      const arrived = pendingLines
      pendingLines = []
      setOutput((lines) => [...lines, ...arrived].slice(-OUTPUT_TAIL_LINES))
    })
  }
  onCleanup(() => {
    if (flushHandle !== null) cancelAnimationFrame(flushHandle)
  })

  // The log follows its tail: the newest lines are what a live view is for.
  let logEl: HTMLPreElement | undefined
  createEffect(() => {
    const lines = output()
    if (lines.length === 0 || !logEl) return
    logEl.scrollTop = logEl.scrollHeight
  })

  const running = (): boolean => loading() || streaming()

  const finish = (message: ApiMessage | null): void => {
    batch(() => {
      setStreaming(false)
      setStep((current) => (current ? { ...current, progress: current.total } : current))
      setStatus(message ?? apiMessage('admin.api.buildSite.built'))
    })
  }

  const fail = (message: ApiMessage | string | null): void => {
    batch(() => {
      setStreaming(false)
      // The alert carries the news; a bar frozen part way would read as "still going".
      setStep(null)
      setError(message ?? apiMessage('admin.buildSite.failed'))
    })
  }

  // Exhaustive on `kind`, so a frame this bundle does not recognize is ignored
  // rather than rendered as an `undefined` log line.
  const handleFrame = (event: BuildSiteStreamEvent): void => {
    switch (event.kind) {
      case 'step':
        setStep({ progress: event.progress, total: event.total ?? STEP_NAMES.length - 1 })
        return
      case 'output':
        appendLine(event.line)
        return
    }
  }

  /** The build without a stream: one blocking request, no steps or output. */
  const buildWithoutStream = async (): Promise<void> => {
    batch(() => {
      setStreaming(false)
      setStep(null)
    })
    await run('/api/build-site', { method: 'POST' }, apiMessage('admin.buildSite.failed'))
  }

  const handleBuild = (): void => {
    stream?.close()
    stream = null
    batch(() => {
      setStreaming(true)
      setStep({ progress: 0, total: STEP_NAMES.length - 1 })
      setOutput([])
      setStatus(null)
      setError(null)
    })
    stream = openSyncStream<BuildSiteStreamEvent, BuildSiteDoneEvent, ApiMessage>(
      '/api/build-site/stream',
      {
        progress: handleFrame,
        done: finish,
        failed: fail,
        disconnected: (received) => {
          stream = null
          if (received) {
            // The build is still running server-side and will publish on its
            // own; starting another would only be refused.
            fail(apiMessage('admin.buildSite.connectionDropped'))
            return
          }
          void buildWithoutStream()
        },
      },
    )
    // `EventSource` could not even be constructed — the same fallback applies.
    if (!stream) void buildWithoutStream()
  }

  const percent = (): number => {
    const current = step()
    return current === null ? 0 : Math.round((current.progress / current.total) * 100)
  }

  return (
    <div>
      <PageHeading page="build-site" />
      <p class="page-desc">{t('admin.buildSite.desc')}</p>
      <StatusAlerts status={status()} error={error()} />

      <Show when={step()}>
        {(current) => (
          <div class="progress-section">
            <div class="progress-label">
              <span class="text-accent">
                {t('admin.buildSite.step', { step: stepName(current()) })}
              </span>
              <span class="text-secondary">{percent()}%</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style={`width: ${percent()}%;`} />
            </div>
            <Show when={output().length > 0}>
              <h3 class="section-subheading">{t('admin.buildSite.output')}</h3>
              <pre class="build-log" data-testid="build-output" ref={logEl}>
                <For each={output()}>{(line) => <div>{line}</div>}</For>
              </pre>
            </Show>
          </div>
        )}
      </Show>

      <button class="btn btn-primary btn-lg" onClick={handleBuild} disabled={running()}>
        {running() ? t('admin.buildSite.building') : t('admin.buildSite.build')}
      </button>
    </div>
  )
}
