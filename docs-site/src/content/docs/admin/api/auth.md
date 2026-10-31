---
title: 'Admin API: Status and Sign-in'
description: 'Admin API routes for server status, the first account, signing in and out, the audit log, and TOTP.'
sidebar:
  label: 'Status and sign-in'
  order: 1
---

Routes for the server status, creating the first account, signing in and out, the sign-in audit log, and the optional TOTP second factor. See [Authentication](/admin/api/#authentication) for how sessions work. Every route here follows the [conventions on the overview page](/admin/api/): the [message triple](/admin/api/#the-message-triple), the [error responses](/admin/api/#error-responses) and [authentication](/admin/api/#authentication).

## Server Status

```
GET /api/status
```

No authentication is required.

Returns server health, whether first-time setup is needed, and which optional capabilities this server offers.

**Response:**

```json
{
  "ok": true,
  "setupRequired": false,
  "totpEnabled": true,
  "sellMode": false,
  "about": {
    "version": "1.0.0",
    "license": "AGPL-3.0-only",
    "sourceUrl": "https://github.com/sloshy/ritual",
    "revisionUrl": "https://github.com/sloshy/ritual/tree/v1.0.0"
  }
}
```

`about` is the running Ritual's source offer: its version, its license, the repository holding its source, and `revisionUrl`, the source of exactly this version (the release tag's tree, or the commit's for a development build). The admin UI shows it at the foot of its navigation. See [Source Code](/attribution/#source-code).

`sellMode` is the **effective** value: `site.sellMode`, or `true` when the server was started with [`--sell-mode`](/commands/admin/#sell-mode). When it is false a client hides its sell surfaces. The `/api/sell/*` and `/api/buylist/*` routes themselves stay open while the `cardkingdom` [price store](/configuration/#price-stores-pricesources) is enabled, because Card Kingdom retail prices come from the same feed.

## Create Admin Account

```
POST /api/setup
```

No session is required. Instead the request carries the one-time setup token `ritual admin` printed when it started (see [First-Time Setup](/commands/admin/#first-time-setup)). A missing or wrong token returns `403 Forbidden`. Only works when no admin user exists; returns `409 Conflict` otherwise.

**Request body:**

```json
{
  "username": "admin",
  "password": "mypassword",
  "setupToken": "Qm9yb3NDaGFybUJvbHQxMjM0"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Admin account created successfully"
}
```

## Log In

```
POST /api/login
```

No authentication is required.

Authenticate with username, password, and optionally a TOTP code. On success, the response sets a session cookie.

**Request body:**

```json
{
  "username": "admin",
  "password": "mypassword",
  "totpCode": "123456"
}
```

| Field      | Type   | Required | Description                             |
| ---------- | ------ | -------- | --------------------------------------- |
| `username` | string | Yes      | Admin username                          |
| `password` | string | Yes      | Admin password                          |
| `totpCode` | string | No       | TOTP code (required if TOTP is enabled) |

**Response (success):**

```json
{
  "success": true
}
```

The response includes a `Set-Cookie` header with the session token.

**Response (TOTP required):**

```json
{
  "success": false,
  "message": "TOTP code required",
  "messageKey": "admin.api.login.totpRequired",
  "totpRequired": true
}
```

**Response (locked out, `429`):**

```json
{
  "success": false,
  "message": "Too many failed attempts. Try again later.",
  "messageKey": "admin.api.login.rateLimited",
  "retryAfterSeconds": 240
}
```

## Log Out

```
POST /api/logout
```

Destroys the current session.

**Request body:** None

**Response:**

```json
{
  "success": true
}
```

## Audit Log

```
GET /api/audit-log
```

Returns recent login attempts, most recent first.

**Query parameters:**

| Parameter | Type   | Default | Description                    |
| --------- | ------ | ------- | ------------------------------ |
| `limit`   | number | `100`   | Max entries to return (1–1000) |

**Response:**

```json
{
  "success": true,
  "entries": [
    {
      "timestamp": "2026-02-26T19:00:00.000Z",
      "ip": "127.0.0.1",
      "username": "admin",
      "success": true,
      "reason": "Login successful",
      "userAgent": "Mozilla/5.0 ..."
    }
  ]
}
```

Every login attempt, successful or failed, is written to `.logins/admin-audit.log` with timestamp, IP address, username, result, reason, and user agent. The admin UI shows the same log under "Audit Log".

## TOTP Setup

```
POST /api/totp/setup
```

Generate a new TOTP secret for two-factor authentication. The secret stays pending until verified.

**Request body:** None

**Response:**

```json
{
  "success": true,
  "secret": "JBSWY3DPEHPK3PXP",
  "uri": "otpauth://totp/Ritual:admin?secret=JBSWY3DPEHPK3PXP&issuer=Ritual&algorithm=SHA1&digits=6&period=30"
}
```

## TOTP Verify

```
POST /api/totp/verify-setup
```

Verify a TOTP code to activate the pending secret. Call it after `/api/totp/setup` to confirm the authenticator app is configured.

**Request body:**

```json
{
  "code": "123456"
}
```

**Response:**

```json
{
  "success": true,
  "message": "TOTP enabled successfully"
}
```

## TOTP Disable

```
POST /api/totp/disable
```

Disable TOTP two-factor authentication.

**Request body:** None

**Response:**

```json
{
  "success": true,
  "message": "TOTP disabled"
}
```

## TOTP Status

```
GET /api/totp/status
```

Check whether TOTP is enabled for the admin account.

**Response:**

```json
{
  "enabled": true
}
```
