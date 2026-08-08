import { type JSX, createSignal, onMount, Show, For } from 'solid-js'
import type { AuditEntry } from '../../audit-log'
import { useT } from '../../../ui/i18n'
import { PageHeading } from '../components/PageHeading'
import { formatDateTime } from '../../../ui/format'

type AuditLogResponse = { success: boolean; entries: AuditEntry[] }

function formatDate(ts: string): string {
  try {
    return formatDateTime(ts)
  } catch {
    return ts
  }
}

export function AuditLog(): JSX.Element {
  const t = useT()
  const [entries, setEntries] = createSignal<AuditEntry[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  const fetchLog = async () => {
    setLoading(true)
    try {
      const resp = await fetch('/api/audit-log?limit=200', { credentials: 'same-origin' })
      const data = (await resp.json()) as AuditLogResponse
      if (data.success) {
        setEntries(data.entries)
      }
    } catch {
      setError(t('admin.auditLog.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    void fetchLog()
  })

  return (
    <Show
      when={!loading()}
      fallback={
        <div>
          <p class="text-muted">{t('admin.auditLog.loading')}</p>
        </div>
      }
    >
      <div>
        <div class="audit-header">
          <PageHeading page="audit-log" />
          <button class="btn btn-secondary" onClick={() => void fetchLog()}>
            {t('admin.auditLog.refresh')}
          </button>
        </div>

        <Show when={error()}>
          <div class="alert alert-error">{error()}</div>
        </Show>

        <Show
          when={entries().length > 0}
          fallback={<p class="text-muted">{t('admin.auditLog.empty')}</p>}
        >
          <div class="audit-scroll">
            <table class="audit-table">
              <thead>
                <tr>
                  <th>{t('admin.auditLog.colTime')}</th>
                  <th>{t('admin.auditLog.colStatus')}</th>
                  <th>{t('admin.auditLog.colUsername')}</th>
                  <th>{t('admin.auditLog.colIp')}</th>
                  <th class="audit-responsive-md">{t('admin.auditLog.colReason')}</th>
                  <th class="audit-responsive-lg">{t('admin.auditLog.colUserAgent')}</th>
                </tr>
              </thead>
              <tbody>
                <For each={entries()}>
                  {(entry) => (
                    <tr class={entry.success ? undefined : 'audit-row-failed'}>
                      <td class="audit-cell-nowrap">{formatDate(entry.timestamp)}</td>
                      <td>
                        <span class={entry.success ? 'badge badge-success' : 'badge badge-error'}>
                          {entry.success ? t('admin.auditLog.success') : t('admin.auditLog.failed')}
                        </span>
                      </td>
                      <td>{entry.username}</td>
                      <td class="audit-cell-mono">{entry.ip}</td>
                      <td class="audit-responsive-md">{entry.reason}</td>
                      <td class="audit-responsive-lg text-ellipsis-sm">{entry.userAgent}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </div>
    </Show>
  )
}
