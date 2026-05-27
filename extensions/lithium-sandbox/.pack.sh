#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p 'require("./package.json").version')
OUT="lithium-sandbox-${VERSION}.tgz"

echo "Plugin version: ${VERSION}"

echo "Building TypeScript -> dist/"
rm -rf dist
TSC="../../node_modules/.bin/tsc"
if [ ! -x "$TSC" ]; then
  echo "ERROR: monorepo tsc not found at $TSC. Run 'pnpm install' at openclaw root first." >&2
  exit 1
fi
"$TSC" -p tsconfig.build.json

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
  openclaw.plugin.json package.json tsconfig.json dist/ src/

echo
echo "Built: $(pwd)/${OUT} ($(du -h "${OUT}" | cut -f1))"
echo
echo "--- contents ---"
tar tzf "${OUT}"
