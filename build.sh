#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if command -v bun >/dev/null 2>&1; then
  BUN="$(command -v bun)"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN="$HOME/.bun/bin/bun"
else
  echo "md-preview: bun is required to build (https://bun.sh)" >&2
  exit 1
fi

"$BUN" install --frozen-lockfile --production
"$BUN" run build.ts
