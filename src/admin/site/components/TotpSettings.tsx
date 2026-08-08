import type { Component } from 'solid-js'
import { createSignal, Match, onMount, Show, Switch } from 'solid-js'
import { useT } from '../../../ui/i18n'

interface TotpSetupData {
  secret: string
  uri: string
}

type TotpStatusResponse = { enabled: boolean }
type TotpSetupResponse = {
  success: boolean
  secret?: string
  uri?: string
  message?: string
}
type TotpActionResponse = { success: boolean; message: string }

export const TotpSettings: Component = () => {
  const t = useT()
  const [totpEnabled, setTotpEnabled] = createSignal(false)
  const [totpSetup, setTotpSetup] = createSignal<TotpSetupData | null>(null)
  const [totpCode, setTotpCode] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [message, setMessage] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)

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
        setError(data.message ?? t('admin.totp.setupFailed'))
      }
    } catch {
      setError(t('admin.totp.startFailed'))
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
        setMessage(t('admin.totp.enabled'))
      } else {
        setError(data.message)
      }
    } catch {
      setError(t('admin.totp.verifyFailed'))
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
        setMessage(t('admin.totp.disabled'))
      } else {
        setError(data.message)
      }
    } catch {
      setError(t('admin.totp.disableFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Show when={message()}>
        <div class="alert alert-success">{message()}</div>
      </Show>
      <Show when={error()}>
        <div class="alert alert-error">{error()}</div>
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
