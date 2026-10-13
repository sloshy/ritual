import type { Component } from 'solid-js'
import { createSignal, Match, onMount, Show, Switch } from 'solid-js'
import { useT } from '../../../ui/i18n'
import { apiMessage } from '../../../api/result'
import { useApiText } from '../hooks/useApiAction'
import type { ApiActionMessage } from '../../../api/result'
import { readSyncMessage } from '../../../sync/message'

interface TotpSetupData {
  secret: string
  uri: string
}

type TotpStatusResponse = { enabled: boolean }
type TotpSetupResponse = {
  success: boolean
  secret?: string
  uri?: string
}
type TotpActionResponse = { success: boolean }

export const TotpSettings: Component = () => {
  const t = useT()
  const [totpEnabled, setTotpEnabled] = createSignal(false)
  const [totpSetup, setTotpSetup] = createSignal<TotpSetupData | null>(null)
  const [totpCode, setTotpCode] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  // Held unrendered and rendered in the JSX, so a language switch relabels them.
  const [message, setMessage] = createSignal<ApiActionMessage | null>(null)
  const [error, setError] = createSignal<ApiActionMessage | null>(null)
  const heldText = useApiText()

  onMount(() => {
    fetch('/api/totp/status', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data: TotpStatusResponse) => setTotpEnabled(data.enabled))
      .catch(() => {})
  })

  const handleSetup = async () => {
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const resp = await fetch('/api/totp/setup', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const data = (await resp.json()) as TotpSetupResponse
      if (data.success && data.secret && data.uri) {
        setTotpSetup({ secret: data.secret, uri: data.uri })
      } else {
        setError(readSyncMessage(data) ?? apiMessage('admin.totp.setupFailed'))
      }
    } catch {
      setError(apiMessage('admin.totp.startFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    if (!totpCode()) return
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/totp/verify-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: totpCode() }),
        credentials: 'same-origin',
      })
      const data = (await resp.json()) as TotpActionResponse
      if (data.success) {
        setTotpEnabled(true)
        setTotpSetup(null)
        setTotpCode('')
        setMessage(apiMessage('admin.totp.enabled'))
      } else {
        setError(readSyncMessage(data) ?? apiMessage('admin.totp.verifyFailed'))
      }
    } catch {
      setError(apiMessage('admin.totp.verifyFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleDisable = async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/totp/disable', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const data = (await resp.json()) as TotpActionResponse
      if (data.success) {
        setTotpEnabled(false)
        setMessage(apiMessage('admin.totp.disabled'))
      } else {
        setError(readSyncMessage(data) ?? apiMessage('admin.totp.disableFailed'))
      }
    } catch {
      setError(apiMessage('admin.totp.disableFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Show when={message()}>
        <div class="alert alert-success">{heldText(message())}</div>
      </Show>
      <Show when={error()}>
        <div class="alert alert-error">{heldText(error())}</div>
      </Show>

      <Switch>
        <Match when={totpEnabled()}>
          <div>
            <p class="totp-status text-success">✓ {t('admin.totp.statusEnabled')}</p>
            <button
              class="btn btn-danger"
              onClick={() => void handleDisable()}
              disabled={loading()}
            >
              {loading() ? t('admin.totp.disabling') : t('admin.totp.disable')}
            </button>
          </div>
        </Match>
        <Match when={totpSetup()}>
          {(setup) => (
            <div class="totp-setup">
              <p class="totp-instruction">{t('admin.totp.addAccount')}</p>
              <div class="code-container">
                <p class="form-hint">{t('admin.totp.secretLabel')}</p>
                <code class="code-display">{setup().secret}</code>
              </div>
              <div class="code-container">
                <p class="form-hint">{t('admin.totp.uriLabel')}</p>
                <code class="code-display-sm">{setup().uri}</code>
              </div>
              <div>
                <label class="form-label">{t('admin.totp.enterCode')}</label>
                <div class="totp-verify-row">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    class="form-input input-code-wide"
                    value={totpCode()}
                    onInput={(e) => setTotpCode(e.currentTarget.value)}
                    placeholder="000000"
                  />
                  <button
                    class="btn btn-primary"
                    onClick={() => void handleVerify()}
                    disabled={loading() || totpCode().length < 6}
                  >
                    {loading() ? t('admin.totp.verifying') : t('admin.totp.verify')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </Match>
        <Match when={!totpEnabled()}>
          <button class="btn btn-primary" onClick={() => void handleSetup()} disabled={loading()}>
            {loading() ? t('admin.totp.settingUp') : t('admin.totp.setUp')}
          </button>
        </Match>
      </Switch>
    </>
  )
}
