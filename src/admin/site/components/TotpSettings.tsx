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
          <p class="totp-status text-success">✓ TOTP is enabled</p>
          <button class="btn btn-danger" onClick={handleDisable} disabled={loading}>
            {loading ? 'Disabling...' : 'Disable TOTP'}
          </button>
        </div>
      ) : totpSetup ? (
        <div class="totp-setup">
          <p class="totp-instruction">Add this account to your authenticator app:</p>
          <div class="code-container">
            <p class="form-hint">Secret key (manual entry):</p>
            <code class="code-display">{totpSetup.secret}</code>
          </div>
          <div class="code-container">
            <p class="form-hint">URI (for QR code generators):</p>
            <code class="code-display-sm">{totpSetup.uri}</code>
          </div>
          <div>
            <label class="form-label">Enter code from authenticator to verify:</label>
            <div class="totp-verify-row">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                class="form-input input-code-wide"
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
