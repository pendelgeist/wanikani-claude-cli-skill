#!/bin/bash
set -euo pipefail

# Claude Code on the web starts from a fresh clone with no node_modules, so
# the CLI can't run (wanakana backs every reading comparison) and `npm test`
# fails at import. Local sessions manage their own install, so skip there.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# npm install rather than npm ci: it's a no-op when node_modules is already
# warm, which is what the cached container image gives later sessions.
npm install --no-audit --no-fund
