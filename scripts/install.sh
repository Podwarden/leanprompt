#!/bin/sh
# Install leanprompt's skills into the current project. Equivalent to
# `npx --yes leanprompt@<version> install "$@"`; there is no second
# implementation here. It installs from npm.
# The version comes from LEANPROMPT_VERSION, else the package.json of the leanprompt
# checkout this script file sits in, else "latest". Piped (`curl ... | sh`), $0 is the
# shell, not this file, so no package.json is read: a project's own package.json must
# never pick the version.
set -eu

if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  echo "leanprompt: node and npx are required (Node 20.19 or newer). Install Node from https://nodejs.org/ and run this again." >&2
  exit 1
fi

version="${LEANPROMPT_VERSION:-}"
if [ -z "$version" ] && [ -f "$0" ]; then
  case "$0" in
    */*) here="${0%/*}" ;;
    *) here="." ;;
  esac
  if [ -f "$here/../package.json" ]; then
    version="$(node -e "const p = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); if (p.name === 'leanprompt' && typeof p.version === 'string') process.stdout.write(p.version)" "$here/../package.json" 2>/dev/null || true)"
  fi
fi
version="${version:-latest}"

if [ "$version" = "latest" ]; then
  spec="leanprompt"
else
  spec="leanprompt@$version"
fi

# Piped, stdin is this script; in a terminal, give the installer the terminal so it can ask.
if [ -t 1 ] && { : </dev/tty; } 2>/dev/null; then
  exec npx --yes "$spec" install "$@" </dev/tty
fi
exec npx --yes "$spec" install "$@"
