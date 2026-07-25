import type { JSX } from 'solid-js'
import { useApiAction } from '../hooks/useApiAction'
import { StatusAlerts } from '../components/StatusAlerts'
import { PageHeading } from '../components/PageHeading'

export function BuildSite(): JSX.Element {
  const { status, error, loading, run } = useApiAction()

  const handleBuild = async () => {
    await run('/api/build-site', { method: 'POST' }, 'Failed to build site')
  }

  return (
    <div>
      <PageHeading page="build-site" />
      <p class="page-desc">
        Generate the static website from your deck files. This may take a few minutes.
      </p>
      <StatusAlerts status={status()} error={error()} />
      <button
        class="btn btn-primary btn-lg"
        onClick={() => void handleBuild()}
        disabled={loading()}
      >
        {loading() ? 'Building... (this may take a while)' : 'Build Site'}
      </button>
    </div>
  )
}
