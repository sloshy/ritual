import { useState, useEffect, useCallback } from 'preact/hooks'
import type { AuditEntry } from '../../audit-log'

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLog = useCallback(async () => {
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
  }, [])

  useEffect(() => {
    fetchLog()
  }, [fetchLog])

  if (loading) {
    return (
      <div>
        <p style="color: var(--text-muted);">Loading audit log...</p>
      </div>
    )
  }

  return (
    <div>
      <div class="flex items-center justify-between mb-4">
        <h2 class="section-heading">📋 Audit Log</h2>
        <button class="btn btn-secondary" onClick={fetchLog}>
          Refresh
        </button>
      </div>

      {error && <div class="alert alert-error">{error}</div>}

      {entries.length === 0 ? (
        <p style="color: var(--text-muted);">No login attempts recorded yet.</p>
      ) : (
        <div class="overflow-x-auto">
          <table class="audit-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Status</th>
                <th>Username</th>
                <th>IP</th>
                <th class="hidden md:table-cell">Reason</th>
                <th class="hidden lg:table-cell">User Agent</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr
                  key={i}
                  style={entry.success ? undefined : 'background: rgba(127, 29, 29, 0.1);'}
                >
                  <td style="white-space: nowrap;">{formatDate(entry.timestamp)}</td>
                  <td>
                    <span class={entry.success ? 'badge badge-success' : 'badge badge-error'}>
                      {entry.success ? 'Success' : 'Failed'}
                    </span>
                  </td>
                  <td>{entry.username}</td>
                  <td style="font-family: monospace; font-size: 0.75rem;">{entry.ip}</td>
                  <td class="hidden md:table-cell">{entry.reason}</td>
                  <td
                    class="hidden lg:table-cell"
                    style="font-size: 0.75rem; max-width: 20rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                  >
                    {entry.userAgent}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
