#!/bin/sh
# The Docker image's HEALTHCHECK (installed as /usr/local/bin/ritual-healthcheck).
#
# One image runs every command, so the check asks the container's own command
# what to probe rather than baking in a port: it reads the `ritual` command
# line of PID 1 (directly, or after `docker run --init`'s init and its `--`)
# and, for a long-running server, fetches a route that answers 200 once the
# server is up, on the port and host that command line gives:
#
#   serve          GET /             (default port 3000)
#   admin          GET /api/status   (default port 8080)
#   cache server     GET /health     (default port 4000)
#   cache feed host  GET /health     (default port 4010)
#
# Any other command (a one-shot such as `lists`, or `mcp`, which has no such
# route) is not probed, and the check passes. A server bound to every
# address, or to none in particular, is probed on loopback.
#
#   ritual-healthcheck          probe, exit 0 (healthy) or 1
#   ritual-healthcheck --url    print the URL it would probe, or nothing
#
# RITUAL_HEALTHCHECK_CMDLINE names a file to read instead of /proc/1/cmdline
# (NUL-separated, as the kernel writes it); the tests use it.
set -eu

mode=${1:-}
cmdline=${RITUAL_HEALTHCHECK_CMDLINE:-/proc/1/cmdline}

# The command line's words, one per positional parameter.
words=$(tr '\0' '\n' < "$cmdline")
IFS='
'
set -f
# shellcheck disable=SC2086 # split on the newlines only
set -- $words
set +f
unset IFS

# Drop everything up to the ritual executable itself.
while [ $# -gt 0 ]; do
  case "$1" in
    ritual | */ritual)
      shift
      break
      ;;
  esac
  shift
done

route=''
port=''
host=''
while [ $# -gt 0 ]; do
  case "$1" in
    serve) [ -n "$route" ] || { route=/ && port=3000; } ;;
    admin) [ -n "$route" ] || { route=/api/status && port=8080; } ;;
    cache)
      if [ -z "$route" ] && [ "${2:-}" = server ]; then
        route=/health && port=4000
      elif [ -z "$route" ] && [ "${2:-}" = feed ] && [ "${3:-}" = host ]; then
        route=/health && port=4010
      fi
      ;;
    -p | --port) port=${2:-$port} && shift ;;
    -p* | --port=*) port=${1#--port=} && port=${port#-p} ;;
    --host) host=${2:-} && shift ;;
    --host=*) host=${1#--host=} ;;
  esac
  [ $# -gt 0 ] && shift
done

[ -n "$route" ] || exit 0

case "$host" in
  '' | 0.0.0.0 | :: | '[::]' | localhost) host=127.0.0.1 ;;
  *:*) host="[$host]" ;;
esac
url="http://$host:$port$route"

if [ "$mode" = --url ]; then
  echo "$url"
  exit 0
fi
wget -q -T 5 -O /dev/null "$url"
