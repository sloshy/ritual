import { type JSX, batch, createSignal, createMemo, onCleanup, Show, For } from 'solid-js'
import { useT, useTKey } from '../../../ui/i18n'
import { StatusAlerts } from '../components/StatusAlerts'
import { PageHeading } from '../components/PageHeading'
import { BuylistRefreshCard } from '../components/BuylistRefreshCard'
import { sellModeEnabled } from '../sell-enabled'
import { useApiAction, useApiText } from '../hooks/useApiAction'
import type { CacheRefreshEvent } from '../../../scryfall/progress'
import type { ParameterlessKey } from '../../../i18n/t'
import { apiMessage, type ApiActionMessage } from '../../../api/result'
import { readSyncMessage, type SyncMessage } from '../../../sync/message'
import { openSyncStream, type SyncStream } from '../sync-stream'

type Stage = 'idle' | 'connecting' | 'download' | 'save' | 'done' | 'error'

/**
 * One rendered step of a refresh. `labelKey` is a {@link MessageKey}, not text:
 * {@link stages} is built once at module load, so a rendered string would leave
 * the step list in the boot-time language after a locale switch.
 */
interface StageInfo {
  id: Stage
  labelKey: ParameterlessKey
  icon: string
}

/**
 * The refresh stages this page renders as a step of its own. The engine reports
 * more (`metadata`, `tags`, `info`, `done`); those drive the message line only.
 */
const RENDERED_STAGES = [
  'download',
  'save',
] as const satisfies readonly CacheRefreshEvent['stage'][]

/** A stage that is also one of this page's {@link Stage} values. */
type RenderedStage = (typeof RENDERED_STAGES)[number]

function isRenderedStage(stage: CacheRefreshEvent['stage']): stage is RenderedStage {
  return RENDERED_STAGES.includes(stage as RenderedStage)
}

// The bulk download streams: cards are parsed and processed as bytes arrive,
// so downloading and processing are a single stage.
const stages: StageInfo[] = [
  { id: 'download', labelKey: 'admin.cache.stageDownload', icon: '📡' },
  { id: 'save', labelKey: 'admin.cache.stageSave', icon: '💾' },
]

function stageIndex(stage: Stage): number {
  return stages.findIndex((s) => s.id === stage)
}

function stageStatus(info: StageInfo, current: Stage): 'pending' | 'active' | 'done' {
  const currentIdx = stageIndex(current)
  const thisIdx = stages.indexOf(info)
  if (current === 'done' || current === 'error') {
    return current === 'done' ? 'done' : thisIdx <= stageIndex('save') ? 'done' : 'pending'
  }
  if (thisIdx < currentIdx) return 'done'
  if (thisIdx === currentIdx) return 'active'
  return 'pending'
}

export function CacheRefresh(): JSX.Element {
  const t = useT()
  const tKey = useTKey()
  const heldText = useApiText()
  // The alerts hold what the server said unrendered (`useApiAction`): a keyed
  // message — a lock time-out, the refreshed notice — renders in the reader's
  // language and relabels when it switches.
  const { status, error, run, setStatus, setError } = useApiAction()
  const [stage, setStage] = createSignal<Stage>('idle')
  const [percentage, setPercentage] = createSignal(0)
  // The engine's progress lines arrive as text; the fallback's own line is a
  // key, held unrendered for the same reason as the alerts.
  const [progressMessage, setProgressMessage] = createSignal<ApiActionMessage>('')
  let stream: SyncStream | null = null
  onCleanup(() => stream?.close())

  const finish = (message: ApiActionMessage | null): void => {
    batch(() => {
      setStage('done')
      setPercentage(100)
      setStatus(message ?? apiMessage('admin.cache.refreshed'))
    })
  }

  const fail = (message: ApiActionMessage | null): void => {
    batch(() => {
      setStage('error')
      setError(message ?? apiMessage('admin.cache.streamFailed'))
    })
  }

  /** The refresh without a stream: one blocking request, no progress. */
  const fallbackRefresh = async (): Promise<void> => {
    batch(() => {
      setStage('download')
      setProgressMessage(apiMessage('admin.cache.fallbackProgress'))
    })
    const ok = await run(
      '/api/cache/refresh',
      { method: 'POST' },
      apiMessage('admin.cache.refreshFailed'),
    )
    if (!ok) {
      setStage('error')
      return
    }
    batch(() => {
      setStage('done')
      setPercentage(100)
      // The same notice the stream path shows when the server said nothing.
      if (status() === null) setStatus(apiMessage('admin.cache.refreshed'))
    })
  }

  const handleRefresh = (): void => {
    stream?.close()
    stream = null
    batch(() => {
      setStage('connecting')
      setPercentage(0)
      setProgressMessage('')
      setError(null)
      setStatus(null)
    })

    stream = openSyncStream<CacheRefreshEvent, SyncMessage, SyncMessage>(
      '/api/cache/refresh/stream',
      {
        progress: (event) => {
          batch(() => {
            if (isRenderedStage(event.stage)) setStage(event.stage)
            if (event.percentage !== undefined) setPercentage(event.percentage)
            // Untyped JSON: a frame without a string `message` must not crash the render.
            setProgressMessage(typeof event.message === 'string' ? event.message : '')
          })
        },
        // Read through `readSyncMessage`: a frame is untyped JSON, and one with no
        // `message` string falls back to the page's own wording.
        done: (event) => {
          stream = null
          finish(readSyncMessage(event))
        },
        failed: (event) => {
          stream = null
          fail(readSyncMessage(event))
        },
        disconnected: (received) => {
          stream = null
          if (received) {
            // The refresh is still running server-side; a second one would only
            // wait on its cache lock and time out.
            fail(apiMessage('admin.cache.connectionDropped'))
            return
          }
          void fallbackRefresh()
        },
      },
    )
    // `EventSource` could not even be constructed — the same fallback applies.
    if (!stream) void fallbackRefresh()
  }

  const isRunning = createMemo(() => {
    const s = stage()
    return s !== 'idle' && s !== 'done' && s !== 'error'
  })

  return (
    <div>
      <PageHeading page="cache-refresh" />
      <p class="page-desc">{t('admin.cache.desc')}</p>
      <StatusAlerts status={status()} error={error()} />

      <Show when={isRunning()}>
        <div class="progress-section">
          <Show when={stage() === 'download'}>
            <div class="progress-gap">
              <div class="progress-label">
                <span class="text-accent">{t('admin.cache.downloading')}</span>
                <span class="text-secondary">{percentage()}%</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" style={`width: ${percentage()}%;`} />
              </div>
              <Show when={heldText(progressMessage())}>
                {(line) => <p class="progress-message">{line()}</p>}
              </Show>
            </div>
          </Show>

          <div class="progress-stages">
            <For each={stages}>
              {(s) => {
                const st = () => stageStatus(s, stage())
                return (
                  <div class="progress-stage" data-status={st()}>
                    <span class="progress-stage-icon">
                      {st() === 'done' ? '✓' : st() === 'active' ? s.icon : '○'}
                    </span>
                    {tKey(s.labelKey)}
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </Show>

      <button class="btn btn-primary btn-lg" onClick={handleRefresh} disabled={isRunning()}>
        {isRunning() ? t('admin.cache.refreshing') : t('admin.cache.refresh')}
      </button>

      {/* Only when this server offers sell mode: with it off the buylist
          routes 404, so the card could only ever report a failure. */}
      <Show when={sellModeEnabled()}>
        <BuylistRefreshCard />
      </Show>
    </div>
  )
}
