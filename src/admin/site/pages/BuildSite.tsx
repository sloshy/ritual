import type { JSX } from 'solid-js'
import { useT } from '../../../ui/i18n'
import { apiMessage } from '../../api/result'
import { useApiAction } from '../hooks/useApiAction'
import { StatusAlerts } from '../components/StatusAlerts'
import { PageHeading } from '../components/PageHeading'

export function BuildSite(): JSX.Element {
  const t = useT()
  const { status, error, loading, run } = useApiAction()

  const handleBuild = async () => {
    await run('/api/build-site', { method: 'POST' }, apiMessage('admin.buildSite.failed'))
  }

  return (
    <div>
      <PageHeading page="build-site" />
      <p class="page-desc">{t('admin.buildSite.desc')}</p>
      <StatusAlerts status={status()} error={error()} />
      <button
        class="btn btn-primary btn-lg"
        onClick={() => void handleBuild()}
        disabled={loading()}
      >
        {loading() ? t('admin.buildSite.building') : t('admin.buildSite.build')}
      </button>
    </div>
  )
}
