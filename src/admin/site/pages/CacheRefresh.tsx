import { useState, useCallback, useRef } from 'preact/hooks'
import { StatusAlerts } from '../components/StatusAlerts'

type Stage = 'idle' | 'connecting' | 'download' | 'parse' | 'process' | 'save' | 'done' | 'error'

interface StageInfo {
  id: Stage
  label: string
  icon: string
}

const stages: StageInfo[] = [
  { id: 'download', label: 'Downloading card data', icon: '📡' },
  { id: 'parse', label: 'Parsing JSON', icon: '📄' },
  { id: 'process', label: 'Processing cards', icon: '⚙️' },
  { id: 'save', label: 'Saving to cache', icon: '💾' },
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

export function CacheRefresh() {
  const [stage, setStage] = useState<Stage>('idle')
  const [percentage, setPercentage] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const fallbackRefresh = useCallback(async () => {
    setStage('download')
    setProgressMessage('Refreshing cache (progress unavailable)...')
    try {
      const resp = await fetch('/api/cache/refresh', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const data = (await resp.json()) as { success: boolean; message: string }
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
      setError('Failed to refresh cache')
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    setStage('connecting')
    setPercentage(0)
    setProgressMessage('')
    setError(null)
    setStatus(null)

    try {
      const es = new EventSource('/api/cache/refresh/stream')
      eventSourceRef.current = es

      es.addEventListener('progress', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as {
            stage: string
            percentage?: number
            message: string
          }
          const s = data.stage as Stage
          if (s === 'download' || s === 'parse' || s === 'process' || s === 'save') {
            setStage(s)
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
          const data = JSON.parse(e.data) as { message: string }
          setStage('done')
          setPercentage(100)
          setStatus(data.message)
        } catch {
          setStage('done')
          setStatus('Cache refreshed successfully')
        }
        es.close()
        eventSourceRef.current = null
      })

      es.addEventListener('error', (e: Event) => {
        // Check if it's an SSE error event with data
        const msgEvent = e as MessageEvent
        if (msgEvent.data) {
          try {
            const data = JSON.parse(msgEvent.data) as { message: string }
            setError(data.message)
          } catch {
            setError('Cache refresh failed')
          }
        } else {
          // Connection error — fall back to POST
          es.close()
          eventSourceRef.current = null
          fallbackRefresh()
          return
        }
        setStage('error')
        es.close()
        eventSourceRef.current = null
      })
    } catch {
      fallbackRefresh()
    }
  }, [fallbackRefresh])

  const isRunning = stage !== 'idle' && stage !== 'done' && stage !== 'error'

  return (
    <div>
      <h2 class="section-heading">🔄 Refresh Cache</h2>
      <p class="page-desc">Download and cache all Scryfall card data. This will take some time.</p>
      <StatusAlerts status={status} error={error} />

      {/* Progress section */}
      {isRunning && (
        <div class="progress-section">
          {/* Progress bar (visible during download) */}
          {stage === 'download' && (
            <div class="progress-gap">
              <div class="progress-label">
                <span class="text-accent">Downloading</span>
                <span class="text-secondary">{percentage}%</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" style={`width: ${percentage}%;`} />
              </div>
              {progressMessage && <p class="progress-message">{progressMessage}</p>}
            </div>
          )}

          {/* Stage list */}
          <div class="progress-stages">
            {stages.map((s) => {
              const st = stageStatus(s, stage)
              return (
                <div key={s.id} class="progress-stage" data-status={st}>
                  <span class="progress-stage-icon">
                    {st === 'done' ? '✓' : st === 'active' ? s.icon : '○'}
                  </span>
                  {s.label}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <button class="btn btn-primary btn-lg" onClick={handleRefresh} disabled={isRunning}>
        {isRunning ? 'Refreshing...' : 'Refresh Cache'}
      </button>
    </div>
  )
}
