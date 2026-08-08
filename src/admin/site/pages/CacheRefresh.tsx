import { type JSX, createSignal, createMemo, onCleanup, Show, For } from 'solid-js'
import { useT, useTKey } from '../../../ui/i18n'
import { StatusAlerts } from '../components/StatusAlerts'
import { PageHeading } from '../components/PageHeading'
import { BuylistRefreshCard } from '../components/BuylistRefreshCard'
import { sellModeEnabled } from '../sell-enabled'
import type { CacheRefreshEvent } from '../../../scryfall/progress'
import type { ParameterlessKey } from '../../../i18n/t'

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

type CacheActionResponse = { success: boolean; message: string }
type CacheDoneEventData = { message: string }
type CacheErrorEventData = { message: string }

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
  const [stage, setStage] = createSignal<Stage>('idle')
  const [percentage, setPercentage] = createSignal(0)
  const [progressMessage, setProgressMessage] = createSignal('')
  const [status, setStatus] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  let eventSourceRef: EventSource | null = null
  onCleanup(() => {
    eventSourceRef?.close()
  })
  const fallbackRefresh = async () => {
    setStage('download')
    setProgressMessage(t('admin.cache.fallbackProgress'))
    try {
      const resp = await fetch('/api/cache/refresh', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const data = (await resp.json()) as CacheActionResponse
      if (data.success) {
        setStage('done')
        setPercentage(100)
        setStatus(data.message)
      } else {
        setStage('error')
        setError(data.message)
      }
    } catch {
      setStage('error')
      setError(t('admin.cache.refreshFailed'))
    }
  }

  const handleRefresh = async () => {
    setStage('connecting')
    setPercentage(0)
    setProgressMessage('')
    setError(null)
    setStatus(null)

    try {
      const es = new EventSource('/api/cache/refresh/stream')
      eventSourceRef = es

      es.addEventListener('progress', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data as string) as CacheRefreshEvent
          if (isRenderedStage(data.stage)) {
            setStage(data.stage)
          }
          if (data.percentage !== undefined) {
            setPercentage(data.percentage)
          }
          setProgressMessage(data.message)
        } catch {
          // ignore parse errors
        }
      })

      es.addEventListener('done', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data as string) as CacheDoneEventData
          setStage('done')
          setPercentage(100)
          setStatus(data.message)
        } catch {
          setStage('done')
          setStatus(t('admin.cache.refreshed'))
        }
        es.close()
        eventSourceRef = null
      })

      es.addEventListener('error', (e: Event) => {
        // Check if it's an SSE error event with data
        const msgEvent = e as MessageEvent
        if (msgEvent.data) {
          try {
            const data = JSON.parse(msgEvent.data as string) as CacheErrorEventData
            setError(data.message)
          } catch {
            setError(t('admin.cache.streamFailed'))
          }
        } else {
          // Connection error — fall back to POST
          es.close()
          eventSourceRef = null
          void fallbackRefresh()
          return
        }
        setStage('error')
        es.close()
        eventSourceRef = null
      })
    } catch {
      void fallbackRefresh()
    }
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
              <Show when={progressMessage()}>
                <p class="progress-message">{progressMessage()}</p>
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

      <button
        class="btn btn-primary btn-lg"
        onClick={() => void handleRefresh()}
        disabled={isRunning()}
      >
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
