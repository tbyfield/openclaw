#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p 'require("./package.json").version')
OUT="lithium-${VERSION}.tgz"

echo "Plugin version: ${VERSION}"

# Compile TypeScript → ./dist (required since openclaw deprecated the
# TS-source fallback for installed plugins). Uses the openclaw monorepo's
# tsc so openclaw/plugin-sdk and @types/node resolve via the workspace.
echo "Building TypeScript -> dist/"
rm -rf dist
TSC="../../node_modules/.bin/tsc"
if [ ! -x "$TSC" ]; then
  echo "ERROR: monorepo tsc not found at $TSC. Run 'pnpm install' at openclaw root first." >&2
  exit 1
fi
"$TSC" -p tsconfig.build.json

# Sanity-check the build emitted what we expect.
if [ ! -f dist/index.js ]; then
  echo "ERROR: dist/index.js missing after build" >&2
  exit 1
fi

tar czf "${OUT}" \
  --transform 's,^,package/,' \
  --exclude='*.test.ts' \
  --exclude='node_modules' \
  --exclude='*.tgz' \
  --exclude='.pack.sh' \
  --exclude='tsconfig.build.json' \
  openclaw.plugin.json package.json tsconfig.json dist/ src/ skills/

echo
echo "Built: $(pwd)/${OUT} ($(du -h "${OUT}" | cut -f1))"
echo
echo "--- contents ---"
tar tzf "${OUT}"
