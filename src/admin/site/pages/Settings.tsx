import { type JSX, createSignal, onMount, Show } from 'solid-js'
import type { AdminConfig, RitualConfig } from '../../../ritual-config'
import {
  INCLUDE_ALL,
  defaultSiteSelection,
  type SiteSelectionConfig,
} from '../../../site/list-selection'
import { fetchRitualConfig } from '../config-api'
import { useApiAction } from '../hooks/useApiAction'
import { StatusAlerts } from '../components/StatusAlerts'
import { TotpSettings } from '../components/TotpSettings'

function listToString(list: string[]): string {
  return list.join('\n')
}

function parseList(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function Settings(): JSX.Element {
  const [config, setConfig] = createSignal<RitualConfig | null>(null)
  const { status, error, loading, run, setStatus, setError } = useApiAction()

  const fetchConfig = async () => {
    const cfg = await fetchRitualConfig()
    if (cfg) setConfig(cfg)
    else setError('Failed to load config')
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

  // Admin settings live under the nested `admin` object; merge into it so the
  // other admin fields are preserved.
  const updateAdminField = (field: keyof AdminConfig, value: string | boolean | number) => {
    setConfig((prev) => (prev ? { ...prev, admin: { ...prev.admin, [field]: value } } : null))
  }

  const updateAdminListField = (field: keyof AdminConfig, value: string) => {
    setConfig((prev) =>
      prev ? { ...prev, admin: { ...prev.admin, [field]: parseList(value) } } : null,
    )
  }

  // The selection lists live under `site`; show the field's value or its default
  // (['*'] for include lists, [] for exclude lists) when absent.
  const siteList = (field: keyof SiteSelectionConfig, fallback: string[]): string[] =>
    config()?.site?.[field] ?? fallback

  const updateSiteListField = (field: keyof SiteSelectionConfig, value: string) => {
    setConfig((prev) => {
      if (!prev) return null
      // When the `site` object doesn't exist yet (init-site not run), seed all
      // three lists with the default so the untouched textareas keep showing '*'
      // and aren't dropped on save. An existing site keeps its other fields
      // (deployment settings and the other selection lists) via the spread.
      const site = prev.site ?? defaultSiteSelection()
      return { ...prev, site: { ...site, [field]: parseList(value) } }
    })
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
              checked={config()!.admin.gitEnabled}
              onChange={(e) => updateAdminField('gitEnabled', e.currentTarget.checked)}
            />
            Enable Git integration
          </label>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={config()!.admin.gitAutoCommit}
              onChange={(e) => updateAdminField('gitAutoCommit', e.currentTarget.checked)}
              disabled={!config()!.admin.gitEnabled}
            />
            Auto-commit changes
          </label>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={config()!.admin.gitAutoPush}
              onChange={(e) => updateAdminField('gitAutoPush', e.currentTarget.checked)}
              disabled={!config()!.admin.gitEnabled || !config()!.admin.gitAutoCommit}
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
              checked={config()!.admin.trustProxy}
              onChange={(e) => updateAdminField('trustProxy', e.currentTarget.checked)}
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
              checked={config()!.admin.secureCookies}
              onChange={(e) => updateAdminField('secureCookies', e.currentTarget.checked)}
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
              checked={config()!.admin.rateLimitEnabled}
              onChange={(e) => updateAdminField('rateLimitEnabled', e.currentTarget.checked)}
            />
            Enable rate limiting
          </label>

          <Show when={config()!.admin.rateLimitEnabled}>
            <div class="form-grid-2col">
              <div>
                <label class="form-label">Max failed attempts</label>
                <input
                  type="number"
                  min={1}
                  class="form-input"
                  value={config()!.admin.rateLimitMaxAttempts}
                  onInput={(e) =>
                    updateAdminField(
                      'rateLimitMaxAttempts',
                      parseInt(e.currentTarget.value, 10) || 5,
                    )
                  }
                />
              </div>
              <div>
                <label class="form-label">Lockout (minutes)</label>
                <input
                  type="number"
                  min={1}
                  class="form-input"
                  value={config()!.admin.rateLimitWindowMinutes}
                  onInput={(e) =>
                    updateAdminField(
                      'rateLimitWindowMinutes',
                      parseInt(e.currentTarget.value, 10) || 5,
                    )
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
              value={config()!.admin.failedAuthDelayMs}
              onInput={(e) =>
                updateAdminField('failedAuthDelayMs', parseInt(e.currentTarget.value, 10) || 0)
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
              value={listToString(config()!.admin.ipAllowList)}
              onInput={(e) => updateAdminListField('ipAllowList', e.currentTarget.value)}
              placeholder="e.g. 192.168.1.*"
            />
          </div>
          <div>
            <label class="form-label">IP Deny List</label>
            <textarea
              class="form-input form-input-monospace"
              value={listToString(config()!.admin.ipDenyList)}
              onInput={(e) => updateAdminListField('ipDenyList', e.currentTarget.value)}
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
              value={listToString(config()!.admin.userAgentAllowList)}
              onInput={(e) => updateAdminListField('userAgentAllowList', e.currentTarget.value)}
              placeholder="e.g. Mozilla*"
            />
          </div>
          <div>
            <label class="form-label">User-Agent Deny List</label>
            <textarea
              class="form-input form-input-monospace"
              value={listToString(config()!.admin.userAgentDenyList)}
              onInput={(e) => updateAdminListField('userAgentDenyList', e.currentTarget.value)}
              placeholder="e.g. *bot*"
            />
          </div>

          {/* Public Site lists */}
          <h3 class="section-subheading">Public Site</h3>
          <p class="form-hint form-hint-gap">
            Controls which lists are published when building the public site. Enter{' '}
            <code>{INCLUDE_ALL}</code> to include every list in that category (the default), or list
            display names (one per line) to publish only those. Leave empty to publish none.
          </p>

          <div>
            <label class="form-label">Decks to publish</label>
            <textarea
              class="form-input form-input-monospace"
              name="includeDecks"
              value={listToString(siteList('includeDecks', [INCLUDE_ALL]))}
              onInput={(e) => updateSiteListField('includeDecks', e.currentTarget.value)}
              placeholder={INCLUDE_ALL}
            />
          </div>
          <div>
            <label class="form-label">Collections to publish</label>
            <textarea
              class="form-input form-input-monospace"
              name="includeCollections"
              value={listToString(siteList('includeCollections', [INCLUDE_ALL]))}
              onInput={(e) => updateSiteListField('includeCollections', e.currentTarget.value)}
              placeholder={INCLUDE_ALL}
            />
          </div>
          <div>
            <label class="form-label">Wanted lists to publish</label>
            <textarea
              class="form-input form-input-monospace"
              name="includeWantedLists"
              value={listToString(siteList('includeWantedLists', [INCLUDE_ALL]))}
              onInput={(e) => updateSiteListField('includeWantedLists', e.currentTarget.value)}
              placeholder={INCLUDE_ALL}
            />
          </div>

          <p class="form-hint form-hint-gap">
            Exclude specific lists by display name (one per line), even when the publish list above
            includes them. The visibility toggles on the Manage Lists page edit these. Leave empty
            to exclude nothing.
          </p>

          <div>
            <label class="form-label">Decks to exclude</label>
            <textarea
              class="form-input form-input-monospace"
              name="excludeDecks"
              value={listToString(siteList('excludeDecks', []))}
              onInput={(e) => updateSiteListField('excludeDecks', e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="form-label">Collections to exclude</label>
            <textarea
              class="form-input form-input-monospace"
              name="excludeCollections"
              value={listToString(siteList('excludeCollections', []))}
              onInput={(e) => updateSiteListField('excludeCollections', e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="form-label">Wanted lists to exclude</label>
            <textarea
              class="form-input form-input-monospace"
              name="excludeWantedLists"
              value={listToString(siteList('excludeWantedLists', []))}
              onInput={(e) => updateSiteListField('excludeWantedLists', e.currentTarget.value)}
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
