import { useCallback } from 'preact/hooks'
import { useApiAction } from '../hooks/useApiAction'
import { StatusAlerts } from '../components/StatusAlerts'

export function BuildSite() {
  const { status, error, loading, run } = useApiAction()

  const handleBuild = useCallback(async () => {
    await run('/api/build-site', { method: 'POST' }, 'Failed to build site')
  }, [run])

  return (
    <div>
      <h2 class="section-heading">🔨 Build Site</h2>
      <p class="page-desc">
        Generate the static website from your deck files. This may take a few minutes.
      </p>
      <StatusAlerts status={status} error={error} />
      <button
        class="btn btn-primary"
        style="padding: 0.75rem 1.5rem;"
        onClick={handleBuild}
        disabled={loading}
      >
        {loading ? 'Building... (this may take a while)' : 'Build Site'}
      </button>
    </div>
  )
}
