import { createSignal, onMount, Show, For } from 'solid-js'
import type { AuditEntry } from '../../audit-log'

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

export function AuditLog() {
  const [entries, setEntries] = createSignal<AuditEntry[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  const fetchLog = async () => {
    setLoading(true)
    try {
      const resp = await fetch('/api/audit-log?limit=200', { credentials: 'same-origin' })
      const data = (await resp.json()) as { success: boolean; entries: AuditEntry[] }
      if (data.success) {
        setEntries(data.entries)
      }
    } catch {
      setError('Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    fetchLog()
  })

  return (
    <Show
      when={!loading()}
      fallback={
        <div>
          <p class="text-muted">Loading audit log...</p>
        </div>
      }
    >
      <div>
        <div class="audit-header">
          <h2 class="section-heading">📋 Audit Log</h2>
          <button class="btn btn-secondary" onClick={fetchLog}>
            Refresh
          </button>
        </div>

        <Show when={error()}>
          <div class="alert alert-error">{error()}</div>
        </Show>

        <Show
          when={entries().length > 0}
          fallback={<p class="text-muted">No login attempts recorded yet.</p>}
        >
          <div class="audit-scroll">
            <table class="audit-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Username</th>
                  <th>IP</th>
                  <th class="audit-responsive-md">Reason</th>
                  <th class="audit-responsive-lg">User Agent</th>
                </tr>
              </thead>
              <tbody>
                <For each={entries()}>
                  {(entry) => (
                    <tr class={entry.success ? undefined : 'audit-row-failed'}>
                      <td class="audit-cell-nowrap">{formatDate(entry.timestamp)}</td>
                      <td>
                        <span class={entry.success ? 'badge badge-success' : 'badge badge-error'}>
                          {entry.success ? 'Success' : 'Failed'}
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
