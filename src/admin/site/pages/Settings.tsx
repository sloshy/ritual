import { type JSX, createSignal, onMount, Show } from 'solid-js'
import type { RitualConfig } from '../../../ritual-config'
import { useApiAction } from '../hooks/useApiAction'
import { StatusAlerts } from '../components/StatusAlerts'
import { TotpSettings } from '../components/TotpSettings'

type ConfigResponse = { success: boolean; config: RitualConfig }

function listToString(list: string[]): string {
  return list.join('\n')
}

export function Settings(): JSX.Element {
  const [config, setConfig] = createSignal<RitualConfig | null>(null)
  const { status, error, loading, run, setStatus, setError } = useApiAction()

  const fetchConfig = async () => {
    try {
      const resp = await fetch('/api/config', { credentials: 'same-origin' })
      const data = (await resp.json()) as ConfigResponse
      if (data.success && data.config) {
        setConfig(data.config)
      }
    } catch {
      setError('Failed to load config')
    }
  }

  onMount(() => {
    void fetchConfig()
  })

  const handleSave = async () => {
    if (!config()) return
    const ok = await run(
      '/api/config',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config()),
      },
      'Failed to save settings',
    )
    if (ok) setStatus('Settings saved')
  }

  const updateField = (field: keyof RitualConfig, value: string | boolean | number) => {
    setConfig((prev) => (prev ? { ...prev, [field]: value } : null))
  }

  const updateListField = (field: keyof RitualConfig, value: string) => {
    const list = value
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    setConfig((prev) => (prev ? { ...prev, [field]: list } : null))
  }

  return (
    <Show
      when={config()}
      fallback={
        <div>
          <p class="text-muted">Loading settings...</p>
        </div>
      }
    >
      <div>
        <h2 class="section-heading">⚙️ Settings</h2>
        <StatusAlerts status={status()} error={error()} />
        <div class="form-container">
          {/* Directories */}
          <div>
            <label class="form-label">Decks Directory</label>
            <input
              type="text"
              class="form-input"
              name="decksDir"
              placeholder="e.g. ./decks"
              value={config()!.decksDir}
              onInput={(e) => updateField('decksDir', e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="form-label">Collections Directory</label>
            <input
              type="text"
              class="form-input"
              name="collectionsDir"
              placeholder="e.g. ./collections"
              value={config()!.collectionsDir}
              onInput={(e) => updateField('collectionsDir', e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="form-label">Wanted List Directory</label>
            <input
              type="text"
              class="form-input"
              name="wantedDir"
              placeholder="e.g. ./wanted"
              value={config()!.wantedDir}
              onInput={(e) => updateField('wantedDir', e.currentTarget.value)}
            />
          </div>

          {/* Git settings */}
          <h3 class="section-subheading">Git Integration</h3>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={config()!.gitEnabled}
              onChange={(e) => updateField('gitEnabled', e.currentTarget.checked)}
            />
            Enable Git integration
          </label>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={config()!.gitAutoCommit}
              onChange={(e) => updateField('gitAutoCommit', e.currentTarget.checked)}
              disabled={!config()!.gitEnabled}
            />
            Auto-commit changes
          </label>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={config()!.gitAutoPush}
              onChange={(e) => updateField('gitAutoPush', e.currentTarget.checked)}
              disabled={!config()!.gitEnabled || !config()!.gitAutoCommit}
            />
            Auto-push after commit
          </label>
          <p class="form-hint">
            When enabled, file changes from admin actions will be automatically committed to git and
            pushed to the remote.
          </p>

          {/* Proxy & Cookie Security */}
          <h3 class="section-subheading">Network Security</h3>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={config()!.trustProxy}
              onChange={(e) => updateField('trustProxy', e.currentTarget.checked)}
            />
            Trust reverse proxy headers
          </label>
          <p class="form-hint">
            Enable if running behind a reverse proxy (nginx, Caddy, etc.). Only parses
            X-Forwarded-For when enabled. Leave off for direct connections.
          </p>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={config()!.secureCookies}
              onChange={(e) => updateField('secureCookies', e.currentTarget.checked)}
            />
            Secure cookies (HTTPS only)
          </label>
          <p class="form-hint">
            Set the Secure flag on session cookies so they are only sent over HTTPS. Enable when
            using TLS or a TLS-terminating reverse proxy.
          </p>

          {/* Two-Factor Authentication */}
          <h3 class="section-subheading">Two-Factor Authentication (TOTP)</h3>
          <TotpSettings />

          {/* Rate Limiting */}
          <h3 class="section-subheading">Rate Limiting</h3>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={config()!.rateLimitEnabled}
              onChange={(e) => updateField('rateLimitEnabled', e.currentTarget.checked)}
            />
            Enable rate limiting
          </label>

          <Show when={config()!.rateLimitEnabled}>
            <div class="form-grid-2col">
              <div>
                <label class="form-label">Max failed attempts</label>
                <input
                  type="number"
                  min={1}
                  class="form-input"
                  value={config()!.rateLimitMaxAttempts}
                  onInput={(e) =>
                    updateField('rateLimitMaxAttempts', parseInt(e.currentTarget.value, 10) || 5)
                  }
                />
              </div>
              <div>
                <label class="form-label">Lockout (minutes)</label>
                <input
                  type="number"
                  min={1}
                  class="form-input"
                  value={config()!.rateLimitWindowMinutes}
                  onInput={(e) =>
                    updateField('rateLimitWindowMinutes', parseInt(e.currentTarget.value, 10) || 5)
                  }
                />
              </div>
            </div>
          </Show>

          <div>
            <label class="form-label">Failed auth delay (ms)</label>
            <input
              type="number"
              min={0}
              step={500}
              class="form-input"
              value={config()!.failedAuthDelayMs}
              onInput={(e) =>
                updateField('failedAuthDelayMs', parseInt(e.currentTarget.value, 10) || 0)
              }
            />
            <p class="form-hint form-hint-top">
              Delay before responding to invalid login attempts (helps prevent brute force).
            </p>
          </div>

          {/* IP Allow/Deny Lists */}
          <h3 class="section-subheading">IP Filtering</h3>
          <p class="form-hint form-hint-gap">
            One entry per line. Supports wildcards (*). Leave empty to allow all. If allow list is
            set, only listed IPs can connect.
          </p>

          <div>
            <label class="form-label">IP Allow List</label>
            <textarea
              class="form-input form-input-monospace"
              value={listToString(config()!.ipAllowList)}
              onInput={(e) => updateListField('ipAllowList', e.currentTarget.value)}
              placeholder="e.g. 192.168.1.*"
            />
          </div>
          <div>
            <label class="form-label">IP Deny List</label>
            <textarea
              class="form-input form-input-monospace"
              value={listToString(config()!.ipDenyList)}
              onInput={(e) => updateListField('ipDenyList', e.currentTarget.value)}
              placeholder="e.g. 10.0.0.5"
            />
          </div>

          {/* User-Agent Allow/Deny Lists */}
          <h3 class="section-subheading">User-Agent Filtering</h3>
          <p class="form-hint form-hint-gap">
            One entry per line. Supports wildcards (*). Leave empty to allow all.
          </p>

          <div>
            <label class="form-label">User-Agent Allow List</label>
            <textarea
              class="form-input form-input-monospace"
              value={listToString(config()!.userAgentAllowList)}
              onInput={(e) => updateListField('userAgentAllowList', e.currentTarget.value)}
              placeholder="e.g. Mozilla*"
            />
          </div>
          <div>
            <label class="form-label">User-Agent Deny List</label>
            <textarea
              class="form-input form-input-monospace"
              value={listToString(config()!.userAgentDenyList)}
              onInput={(e) => updateListField('userAgentDenyList', e.currentTarget.value)}
              placeholder="e.g. *bot*"
            />
          </div>

          {/* Save */}
          <button class="btn btn-primary" onClick={() => void handleSave()} disabled={loading()}>
            {loading() ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </Show>
  )
}
