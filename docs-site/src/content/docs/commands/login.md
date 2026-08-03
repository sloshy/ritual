---
title: 'login'
---

Login to a supported website to save authentication tokens for future requests, check the stored login, or clear it.

## Usage

```bash
./ritual login archidekt [options]
./ritual login status [--output <format>]
./ritual login logout [--output <format>] [--quiet]
```

## Subcommands

| Subcommand  | Description                                                   |
| ----------- | ------------------------------------------------------------- |
| `archidekt` | Login to Archidekt for private deck access                    |
| `status`    | Show the stored login and whether its session is still usable |
| `logout`    | Clear the stored Archidekt login token                        |

## `login archidekt`

Interactively prompts for a username and password on a terminal. When a valid session already exists, the command reports it and exits without prompting (use `--force-login` to login again anyway).

### Options

| Option                  | Description                                  | Default |
| ----------------------- | -------------------------------------------- | ------- |
| `-f, --force-login`     | Force a new login even if a session exists   | `false` |
| `--username <username>` | Archidekt username or email (for scripting)  |         |
| `--password-stdin`      | Read the password from stdin (for scripting) | `false` |

### Non-Interactive Login

For scripts and agents, pass `--username` together with `--password-stdin` and pipe the password on stdin — no prompts are shown, and explicit credentials always perform a fresh login:

```bash
printf '%s' "$ARCHIDEKT_PASSWORD" | ./ritual login archidekt --username myuser --password-stdin
```

Passing only one of the two flags is a usage error (exit code `2`), as is an empty password on stdin. When prompts are disabled (`--no-input`, `RITUAL_NO_INPUT`, or stdin is not a terminal) and no credential flags are given, the command fails with a usage error pointing at `--username`/`--password-stdin` instead of hanging.

### Exit Codes

| Code | Meaning                                                                          |
| ---- | -------------------------------------------------------------------------------- |
| `0`  | Logged in (or a valid session already existed)                                   |
| `1`  | The login itself failed (bad credentials, network error)                         |
| `2`  | Usage error: cancelled prompts, missing/partial credential flags, empty password |

## `login status`

Reports whether an Archidekt login is stored, for which user, and — the question a script is really asking — whether the next sync will authenticate with it. Never touches the network: the validity comes from the stored tokens' own `exp` claims.

An expired **access** token is not a problem on its own; it is refreshed automatically on the next request. Only when the **refresh** token has expired too does the session need a fresh `login archidekt`, which is what `loginRequired` reports.

```bash
./ritual login status
# Logged in to Archidekt as myuser (session valid until 2026-08-03T00:00:00.000Z)
```

| Stored login                  | Text line                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Access token valid            | `Logged in to Archidekt as myuser (session valid until <ISO>)`                              |
| Access expired, refresh OK    | `Logged in to Archidekt as myuser (access token expired; it refreshes on the next request)` |
| Both expired                  | `Logged in to Archidekt as myuser (session expired — run "ritual login archidekt")`         |
| Stored, but naming no account | `Logged in to Archidekt (the stored login does not name an account)`                        |
| None                          | `Not logged in.`                                                                            |

```bash
./ritual login status --output json
```

```json
{
  "loggedIn": true,
  "username": "myuser",
  "accessTokenExpiration": "2026-08-03T00:00:00.000Z",
  "accessTokenValid": true,
  "refreshTokenExpiration": "2026-09-01T00:00:00.000Z",
  "refreshTokenValid": true,
  "loginRequired": false
}
```

This is the same payload the admin API serves at `GET /api/login/archidekt` and the same snapshot the MCP `get_sync_status` tool carries as its `archidekt` section, so every surface answers the question identically.

The status line is the command's entire payload, so `status` registers no `--quiet` ([shared convention](/#scripting-conventions)). To branch purely on the exit code, redirect stdout:

```bash
./ritual login status > /dev/null && echo "ready to sync" || echo "sign in first"
```

### Exit Codes

| Code | Meaning                                                                      |
| ---- | ---------------------------------------------------------------------------- |
| `0`  | A stored login whose session can still authenticate (`loginRequired: false`) |
| `1`  | A stored login whose tokens have all expired — run `ritual login archidekt`  |
| `3`  | No stored Archidekt login                                                    |

## `login logout`

Deletes the stored Archidekt token file. Reports the username that was logged out, or that there was nothing to clear; both cases exit `0`. It takes the same `--output` flag as `status`, plus `--quiet`, which drops the text confirmation line while still emitting the structured payload under `--output json`/`ndjson`.

```bash
./ritual login logout
# Logged out of Archidekt (was myuser). Stored token cleared.

./ritual login logout --output json
```

```json
{
  "loggedOut": true,
  "username": "myuser"
}
```

With nothing stored the payload is `{ "loggedOut": false }`.

## Notes

:::note[Moxfield Login]

Moxfield login is currently not supported due to an explicit lack of support from Moxfield. You can still import decks from Moxfield using the `import` command, but you cannot upload data to your Moxfield account or access private decks.

:::

## Token Storage

Authentication tokens are stored locally in the `.logins/` directory and are used automatically for subsequent requests.
