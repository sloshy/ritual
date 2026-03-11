import { useState, useEffect, useCallback } from 'preact/hooks'

interface TotpSetupData {
  secret: string
  uri: string
}

export function TotpSettings() {
  const [totpEnabled, setTotpEnabled] = useState(false)
  const [totpSetup, setTotpSetup] = useState<TotpSetupData | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/totp/status', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data: { enabled: boolean }) => setTotpEnabled(data.enabled))
      .catch(() => {})
  }, [])

  const handleSetup = useCallback(async () => {
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const resp = await fetch('/api/totp/setup', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const data = (await resp.json()) as {
        success: boolean
        secret?: string
        uri?: string
        message?: string
      }
      if (data.success && data.secret && data.uri) {
        setTotpSetup({ secret: data.secret, uri: data.uri })
      } else {
        setError(data.message ?? 'Setup failed')
      }
    } catch {
      setError('Failed to start TOTP setup')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleVerify = useCallback(async () => {
    if (!totpCode) return
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/totp/verify-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: totpCode }),
        credentials: 'same-origin',
      })
      const data = (await resp.json()) as { success: boolean; message: string }
      if (data.success) {
        setTotpEnabled(true)
        setTotpSetup(null)
        setTotpCode('')
        setMessage('TOTP enabled successfully. You will need to enter a code on next login.')
      } else {
        setError(data.message)
      }
    } catch {
      setError('Verification failed')
    } finally {
      setLoading(false)
    }
  }, [totpCode])

  const handleDisable = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/totp/disable', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const data = (await resp.json()) as { success: boolean; message: string }
      if (data.success) {
        setTotpEnabled(false)
        setMessage('TOTP disabled')
      } else {
        setError(data.message)
      }
    } catch {
      setError('Failed to disable TOTP')
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <>
      {message && <div class="alert alert-success">{message}</div>}
      {error && <div class="alert alert-error">{error}</div>}

      {totpEnabled ? (
        <div>
          <p style="font-size: 0.8125rem; color: var(--success-text); margin-bottom: 0.5rem;">
            ✓ TOTP is enabled
          </p>
          <button class="btn btn-danger" onClick={handleDisable} disabled={loading}>
            {loading ? 'Disabling...' : 'Disable TOTP'}
          </button>
        </div>
      ) : totpSetup ? (
        <div class="space-y-3">
          <p style="font-size: 0.8125rem; color: var(--text-secondary);">
            Add this account to your authenticator app:
          </p>
          <div style="background: var(--bg-hover); padding: 0.75rem; border-radius: 0.375rem;">
            <p class="form-hint" style="margin-bottom: 0.25rem;">
              Secret key (manual entry):
            </p>
            <code style="font-size: 0.8125rem; color: oklch(75% 0.15 85); font-family: monospace; word-break: break-all; user-select: all;">
              {totpSetup.secret}
            </code>
          </div>
          <div style="background: var(--bg-hover); padding: 0.75rem; border-radius: 0.375rem;">
            <p class="form-hint" style="margin-bottom: 0.25rem;">
              URI (for QR code generators):
            </p>
            <code style="font-size: 0.75rem; color: var(--text-secondary); font-family: monospace; word-break: break-all; user-select: all;">
              {totpSetup.uri}
            </code>
          </div>
          <div>
            <label class="form-label">Enter code from authenticator to verify:</label>
            <div class="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                class="form-input"
                style="width: 8rem; font-family: monospace; letter-spacing: 0.15em; text-align: center;"
                value={totpCode}
                onInput={(e) => setTotpCode(e.currentTarget.value)}
                placeholder="000000"
              />
              <button
                class="btn btn-primary"
                onClick={handleVerify}
                disabled={loading || totpCode.length < 6}
              >
                {loading ? 'Verifying...' : 'Verify & Enable'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button class="btn btn-primary" onClick={handleSetup} disabled={loading}>
          {loading ? 'Setting up...' : 'Set Up TOTP'}
        </button>
      )}
    </>
  )
}
