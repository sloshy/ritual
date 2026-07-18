---
title: 'login'
---

Login to a supported website to save authentication tokens for future requests, check the stored login, or clear it.

## Usage

```bash
./ritual login archidekt [options]
./ritual login status [--output <format>] [--quiet]
./ritual login logout
```

## Subcommands

| Subcommand  | Description                                |
| ----------- | ------------------------------------------ |
| `archidekt` | Login to Archidekt for private deck access |
| `status`    | Show the stored Archidekt login, if any    |
| `logout`    | Clear the stored Archidekt login token     |

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

Reports whether an Archidekt login token is stored and for which user. Never touches the network — it reads the stored token only.

```bash
./ritual login status
# Logged in to Archidekt as myuser

./ritual login status --output json
```

```json
{
  "loggedIn": true,
  "username": "myuser"
}
```

Without a stored login the text output is `Not logged in.` and the JSON payload is `{ "loggedIn": false }`.

`--quiet` suppresses all output in every format, so scripts can branch purely on the exit code:

```bash
./ritual login status --quiet && echo "logged in" || echo "not logged in"
```

### Exit Codes

| Code | Meaning                   |
| ---- | ------------------------- |
| `0`  | A stored login exists     |
| `3`  | No stored Archidekt login |

## `login logout`

Deletes the stored Archidekt token file. Reports the username that was logged out, or that there was nothing to clear; both cases exit `0`.

```bash
./ritual login logout
# Logged out of Archidekt (was myuser). Stored token cleared.
```

## Notes

:::note[Moxfield Login]

Moxfield login is currently not supported due to an explicit lack of support from Moxfield. You can still import decks from Moxfield using the `import` command, but you cannot upload data to your Moxfield account or access private decks.

:::

## Token Storage

Authentication tokens are stored locally in the `.logins/` directory and are used automatically for subsequent requests.
