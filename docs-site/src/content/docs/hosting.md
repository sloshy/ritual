---
title: 'Host Ritual Yourself'
description: 'Which of Ritual’s servers you can run, how far to expose each one, and how to keep one running as a service behind a tunnel or reverse proxy.'
---

Ritual can run several servers: the admin site, the MCP server for AI assistants, the public site with or without a live API, and a shared card cache. This page puts them side by side, says which are meant to face the internet, and shows how to keep one running as a long-lived service. Each server's own page has the full detail; this page links to it.

:::caution[Exposing a server is your responsibility]
Most of these servers can read **and change** your lists, and with [git auto-push](/configuration/#git-integration) turned on they also push to your repository. A server reachable from the internet will be found and probed by strangers. Ritual has sign-in protection, rate limits and size caps, but it is a single-user hobby tool, not a hardened web service. If you are not sure what you are doing, keep the server on your own machine or a private network.
:::

## What Can Be Served

The defaults for each server. "Loopback" means the server answers only on this machine (`127.0.0.1`); `0.0.0.0` means every network interface, so anyone on your network can reach it.

| Server                                                       | Command                       | Default port | Default bind            | What it exposes                                                                                                   | Authentication                                                                                                                                                                                           | Status                    |
| ------------------------------------------------------------ | ----------------------------- | ------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| [Admin site and API](/commands/admin/)                       | `ritual admin`                | `8080`       | `0.0.0.0`               | **Read and write**: every list, history, settings, syncs, site builds, git commits                                | Admin account (password, optional TOTP), session cookie; the first account needs the setup token or `ritual admin setup`                                                                                 | Stable                    |
| [MCP over HTTP](/commands/mcp/#http-streamable-http)         | `ritual mcp --transport http` | `8765`       | Loopback                | **Read and write**: the same operations as the admin site                                                         | Bearer token, [OAuth sign-in](/commands/mcp/#oauth-sign-in-beta), or both. With neither it serves loopback only: a non-loopback `--host` or a `--public-url` is refused unless `--allow-unauthenticated` | Stable; OAuth is **beta** |
| [MCP inside the admin](/commands/admin/#embedded-mcp-server) | `ritual admin --mcp`          | `8765`       | The admin's (`0.0.0.0`) | **Read and write**, as above                                                                                      | Bearer token, OAuth (`--mcp-oauth`), or both; one is required                                                                                                                                            | Stable; OAuth is **beta** |
| MCP over stdio                                               | `ritual mcp`                  | none         | No socket               | Read and write, to the client that launched it                                                                    | Whoever starts the process                                                                                                                                                                               | Stable                    |
| [Static public site](/commands/serve/)                       | `ritual serve`                | `3000`       | `0.0.0.0`               | **Read**: the built `dist/` files                                                                                 | None                                                                                                                                                                                                     | Stable                    |
| [Public site with live API](/public-site/hosted/)            | `ritual serve --api`          | `3000`       | `0.0.0.0`               | **Read**: live list data, card search, prices, buylist quotes. Can trigger Scryfall lookups and card-cache writes | None                                                                                                                                                                                                     | **Beta**                  |
| [Cache server](/commands/cache/#server)                      | `ritual cache server`         | `4000`       | Loopback                | **Read and write** the shared card cache (not your lists)                                                         | **None, including its write routes**                                                                                                                                                                     | Stable                    |
| [Cache feed host](/commands/cache/#feed-host)                | `ritual cache feed host`      | `4010`       | Loopback                | **Read**: Scryfall bulk files over HTTP, plus BitTorrent seeding                                                  | None                                                                                                                                                                                                     | **Experimental**          |

[`SECURITY.md`](https://github.com/sloshy/ritual/blob/main/SECURITY.md#deployment-assumptions) has the same table with more detail on each server's protections.

## Choose How Far to Expose It

There are three levels. Pick the smallest one that does what you need.

### This machine only

Bound to loopback, a server answers only programs on the same computer. This is the right choice whenever the client runs where Ritual runs: your browser on the admin site, Claude Code or Claude Desktop on the MCP server (which can use stdio and open no port at all).

`ritual mcp`, `ritual cache server` and `ritual cache feed host` bind loopback by default. **`ritual admin` and `ritual serve` bind `0.0.0.0` by default**, so pass `--host 127.0.0.1` to keep them on this machine:

```bash
ritual admin --host 127.0.0.1
ritual serve --host 127.0.0.1
```

### A private network or VPN

A home network, or a VPN such as [Tailscale](https://tailscale.com) or [WireGuard](https://www.wireguard.com), lets your own devices reach the server while the internet cannot. This is the **recommended way to use the admin site from another device**: the admin site was built for trusted networks.

- To serve only on the VPN, bind to the machine's VPN address (`ritual admin --host 100.101.102.103`, with your own address). On a home network, the default `0.0.0.0` works, and [`admin.ipAllowList`](/commands/admin/#ip-allowdeny-lists) can narrow who connects.
- Plain HTTP across a VPN is encrypted by the VPN itself. Leave `admin.secureCookies` off unless the admin is really reached over `https://`: a `Secure` cookie is only sent over HTTPS, so you would not stay signed in.
- The cache server belongs here at most: it has no sign-in, and its write routes can clear the cache. Never put it on the internet.

### The public internet, through a tunnel or reverse proxy

Here a tunnel or reverse proxy gives the server a public `https://` address while the server itself stays bound to loopback. What that means per server:

- **Static public site:** designed for it. You usually do not need a server at all: publish the files to GitHub Pages or any static host, as [Publish Your Deck Site](/guides/publish-site/) describes. Plain `ritual serve` behind a proxy also works; it only serves files.
- **`serve --api`:** **beta**, read-only, and unauthenticated. It has no write routes, but anyone can query it, it has no rate limiting, and some routes make Scryfall requests on a caller's behalf. Put a proxy with rate limiting in front if you need it. See [Hosting with a Live Backend](/public-site/hosted/).
- **MCP endpoint:** needed for hosted assistants. Claude's custom connectors run on Claude's servers, so they must reach your endpoint over the internet. Ritual supports this with [OAuth sign-in](/commands/mcp/#oauth-sign-in-beta) (beta) for Claude, and a bearer token for clients that can send one. The rest of this page uses it as the worked example.
- **Admin site and API:** not recommended. If you do it anyway, everything in the checklist below applies, plus two-factor sign-in and, ideally, an IP allow list.
- **Cache feed host:** **experimental**; it is built to be public behind a TLS proxy. See [Serving publicly](/commands/cache/#serving-publicly).
- **Cache server:** never.

## Checklist Before Exposing Anything

- **Bind to loopback** (`--host 127.0.0.1`) and let the tunnel or proxy be the only way in. Check your router does not forward the port as well.
- **Use HTTPS at the tunnel or proxy.** OAuth refuses a plain `http://` public URL except for local testing.
- **Tell Ritual its public address.** On a loopback bind the MCP endpoint refuses requests for any other host name (`403`) unless you pass [`--public-url`](/commands/mcp/#behind-a-reverse-proxy-or-tunnel) (`--mcp-public-url` for `ritual admin --mcp`). The value is an origin only, such as `https://mcp.example.com`.
- **Turn on `admin.trustProxy` behind a proxy, and only then.** With it on, Ritual takes each client's address from the proxy's `X-Forwarded-For` entry, so rate limits and the audit log apply per client instead of to the proxy. `--oauth` (or `--mcp-oauth`) on a loopback bind with a non-loopback public URL refuses to start without it (exit `2`). Never turn it on when clients can also reach Ritual directly: they could then claim any address. See [Network options](/commands/admin/#network-options).
- **Set `admin.secureCookies`** when the admin site is served over HTTPS, so its session cookie is never sent over plain HTTP.
- **Use a strong, unique admin password, and turn on two-factor sign-in.** OAuth signs in with the admin account, so the password guards the MCP endpoint too. TOTP is turned on from the admin site's **Settings → Two-Factor Authentication** (run `ritual admin --host 127.0.0.1` once to do it). See [Two-Factor Authentication](/commands/admin/#two-factor-authentication-totp).
- **Keep tokens out of sight.** Give the MCP token through the `RITUAL_MCP_TOKEN` environment variable, read from a file only you can read (`chmod 600`). Do not pass `--token` on a long-running command line, where other users of the machine can see it with `ps`. Generate one with `openssl rand -hex 32`.
- **One OAuth server per workspace.** The OAuth state in `.logins/mcp-oauth.json`, and the sign-in rate limits held in memory, belong to one process. Do not serve the same workspace's OAuth from two processes at once (for example `ritual mcp --oauth` and `ritual admin --mcp --mcp-oauth`).
- **Keep `.logins/` out of git.** Ritual writes a `.logins/.gitignore` for you; do not override it. See [What Ritual stores on your computer](/reference/security/#what-ritual-stores-on-your-computer).
- **Keep Ritual updated.** Only the latest release gets security fixes. Run [`ritual self-update`](/commands/self-update/), then restart the service, and run [`ritual migrate`](/commands/migrate/) if the log says the workspace has pending updates (a service never answers the migrate prompt).
- **Know how to cut access off:**
  - Every OAuth client: change the admin password (`ritual admin reset-password`) or turn TOTP on or off. This works at once, even on a running server. Restart the admin site afterwards too, since its browser sessions are kept in memory.
  - The bearer token: put a new one in the token file and restart the service.
  - Everything: stop the service, or the tunnel.

## Running It as a Service

A service starts when the computer does and restarts the server if it stops. The examples run this command against a workspace:

```bash
ritual --base-dir /path/to/my-cards mcp --transport http --host 127.0.0.1 --port 8765 \
  --public-url https://mcp.example.com --oauth
```

Before the first start, create the admin account and turn on `admin.trustProxy` in that workspace:

```bash
cd /path/to/my-cards
ritual admin setup --username me
ritual config set admin.trustProxy true
```

With `--oauth`, a token is optional. Set one as well if Claude Code or a script should connect with it; `/mcp` then accepts both. The examples read it from a file so it never appears on a command line.

`Ctrl+C` and `SIGTERM` stop the server cleanly, so the service manager's own stop commands work. Ritual writes its log lines to stderr.

### macOS (launchd)

On macOS, a **LaunchAgent** runs a program as you. It runs only while you are logged in, so the Mac must stay logged in to keep the endpoint up.

Put the service files in a folder of their own, say `/Users/you/ritual-service`, and the token in a file only you can read:

```bash
mkdir -p ~/ritual-service/logs
(umask 077; openssl rand -hex 32 > ~/ritual-service/mcp-token)
```

A wrapper script, `~/ritual-service/run-mcp.sh`, reads the token into the environment and then replaces itself with Ritual (`exec`), so launchd watches the Ritual process directly:

```sh
#!/bin/sh
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
RITUAL_MCP_TOKEN=$(cat "$DIR/mcp-token")
export RITUAL_MCP_TOKEN
exec "$HOME/.local/bin/ritual" --base-dir "$HOME/my-cards" \
  mcp --transport http --host 127.0.0.1 --port 8765 \
  --public-url https://mcp.example.com --oauth
```

Make it executable with `chmod +x ~/ritual-service/run-mcp.sh`. `~/.local/bin/ritual` is where the install script puts the binary; change it if yours is elsewhere (`command -v ritual`).

Then the LaunchAgent, `~/Library/LaunchAgents/com.example.ritual-mcp.plist`. launchd does not expand `~` or `$HOME` in this file, so write full paths, and give it a `PATH`: it does not read your shell profile, and Ritual needs to find `git` when [git integration](/configuration/#git-integration) is on.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.ritual-mcp</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>/Users/you/ritual-service/run-mcp.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>/Users/you</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/Users/you/ritual-service/logs/ritual-mcp.log</string>
  <key>StandardErrorPath</key><string>/Users/you/ritual-service/logs/ritual-mcp.log</string>
</dict>
</plist>
```

`RunAtLoad` starts it when you log in, `KeepAlive` restarts it whenever it exits, and `ThrottleInterval` waits 10 seconds between restarts so a startup error does not spin.

Load, restart and remove it:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.ritual-mcp.plist   # load and start
launchctl kickstart -k gui/$(id -u)/com.example.ritual-mcp                             # restart (after an update)
launchctl bootout gui/$(id -u)/com.example.ritual-mcp                                  # stop and unload
tail -f ~/ritual-service/logs/ritual-mcp.log                                           # watch the log
```

If the log shows the server cannot read the workspace, check that it is not in `Documents`, `Desktop` or `Downloads`, which macOS guards from background programs.

A `cloudflared` tunnel (below) can run as a second LaunchAgent in the same way, with `ProgramArguments` naming the `cloudflared` binary and its arguments.

### Linux (systemd)

This example is a **user unit**: it runs as you, so it can read and write your workspace, the per-user card cache (`~/.cache/ritual`) and your git setup without any permission changes. A system unit with a dedicated account is the more locked-down choice, but then that account must own the workspace and the cache, and have its own git credentials if auto-push is on. This example has not been tested by the Ritual project; check it against your distribution's systemd documentation.

Put the token in an environment file only you can read:

```bash
mkdir -p ~/ritual-service
(umask 077; printf 'RITUAL_MCP_TOKEN=%s\n' "$(openssl rand -hex 32)" > ~/ritual-service/mcp.env)
```

Then the unit, `~/.config/systemd/user/ritual-mcp.service` (`%h` is your home folder):

```ini
[Unit]
Description=Ritual MCP server

[Service]
EnvironmentFile=%h/ritual-service/mcp.env
ExecStart=%h/.local/bin/ritual --base-dir %h/my-cards mcp --transport http --host 127.0.0.1 --port 8765 --public-url https://mcp.example.com --oauth
Restart=on-failure
RestartSec=10
# Exit 2 (a usage error) and 3 (no admin account) will not fix themselves.
RestartPreventExitStatus=2 3
NoNewPrivileges=true

[Install]
WantedBy=default.target
```

Start it, and let it run while you are logged out:

```bash
systemctl --user daemon-reload
systemctl --user enable --now ritual-mcp
loginctl enable-linger "$USER"          # keep user services running without a login
systemctl --user restart ritual-mcp     # after an update
journalctl --user -u ritual-mcp -f      # watch the log
```

### Windows

Ritual has no built-in service installer for Windows yet ([issue #23](https://github.com/sloshy/ritual/issues/23)). Task Scheduler can start the same command at log-on or at startup, or a service wrapper can run it as a Windows service. Set `RITUAL_MCP_TOKEN` in the task's or the wrapper's environment rather than passing `--token`.

### Docker

The Ritual image runs any command, servers included. See [Docker](/docker/) for mounts, the health check (the MCP server has none of its own) and Compose examples.

## Putting a Tunnel or Proxy in Front

### Cloudflare Tunnel

A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) connects out from your machine to Cloudflare, so you open no ports on your router. You need a domain on Cloudflare. This sets up a locally managed tunnel with the `cloudflared` command:

```bash
cloudflared tunnel login                                  # once: authorize cloudflared for your domain
cloudflared tunnel create ritual-mcp                      # prints the tunnel's ID and writes its credentials file
cloudflared tunnel route dns ritual-mcp mcp.example.com   # point the host name at the tunnel
```

Then a config file, say `~/ritual-service/cloudflared.yml`, with one rule for the MCP host name and a catch-all that refuses everything else:

```yaml
tunnel: <tunnel-id>
credentials-file: /Users/you/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: mcp.example.com
    service: http://127.0.0.1:8765
  - service: http_status:404
```

Run it with `cloudflared tunnel --config ~/ritual-service/cloudflared.yml run`, as a service of its own like Ritual.

Two things to know:

- **One subdomain level.** Cloudflare's free certificate covers your domain and its first-level subdomains, so `mcp.example.com` works and `mcp.mtg.example.com` does not get HTTPS.
- **`cert.pem` is not needed to run the tunnel.** `cloudflared tunnel login` saves `~/.cloudflared/cert.pem`, a credential for your whole Cloudflare account. The running tunnel needs only its own credentials file. Once the tunnel and its host names are set up, you can delete `cert.pem`, and run `cloudflared tunnel login` again when you next need to change them.

Cloudflare adds each visitor's address to `X-Forwarded-For`, which is what `admin.trustProxy` reads.

### A reverse proxy

Any reverse proxy that terminates HTTPS works. With [Caddy](https://caddyserver.com), which gets the certificate for you, a whole `Caddyfile` can be:

```
mcp.example.com {
	reverse_proxy 127.0.0.1:8765
}
```

The one requirement that matters for Ritual: **the proxy must put the real client address last in `X-Forwarded-For`**. With `admin.trustProxy` on, Ritual reads only the rightmost entry, the one your proxy adds, and ignores whatever a client wrote before it. Caddy does this by default; in nginx, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` appends it. Keep the original `Host` header too, since that is the host name `--public-url` matches: Caddy keeps it by default, and in nginx add `proxy_set_header Host $host;`.

Other tunnels, such as Tailscale Funnel and ngrok, work on the same principle: a public HTTPS address forwarded to the loopback port.

## Check It Works

From any machine, an unauthenticated request should be refused with `401` and point at the OAuth metadata:

```bash
curl -i -X POST https://mcp.example.com/mcp
# status 401, with this header among the others:
# WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"
```

The two metadata documents should name your public address. In the first, `resource` should be `https://mcp.example.com/mcp`; in the second, `issuer` should be `https://mcp.example.com`:

```bash
curl https://mcp.example.com/.well-known/oauth-protected-resource
curl https://mcp.example.com/.well-known/oauth-authorization-server
```

A `403` on every request means `--public-url` is missing or names another host. A gateway error page from the tunnel or proxy means it cannot reach Ritual: check the service is running and the port matches.

Then add the connector in Claude, as [Connect Claude Over the Internet](/guides/ai-agents/#connect-claude-over-the-internet-beta) describes.

## Where Next

- [`ritual mcp`](/commands/mcp/): the HTTP transport, the public URL, OAuth sign-in and its limits.
- [`ritual admin`](/commands/admin/): the admin site's sign-in, rate limiting, network options and embedded MCP server.
- [Hosting with a Live Backend](/public-site/hosted/) and [`ritual serve`](/commands/serve/): the public site with its live API.
- [`ritual cache`](/commands/cache/): the cache server and the cache feed.
- [Docker](/docker/): running any of these in a container.
- [Security and Privacy](/reference/security/) and [`SECURITY.md`](https://github.com/sloshy/ritual/blob/main/SECURITY.md): what each server protects, and how to report a problem.
