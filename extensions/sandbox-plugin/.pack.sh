#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p 'require("./package.json").version')
OUT="sandbox-plugin-${VERSION}.tgz"

echo "Plugin version: ${VERSION}"
echo "Building TypeScript -> dist/"
rm -rf dist
TSC="../../node_modules/.bin/tsc"
"$TSC"

if [ ! -f dist/index.js ]; then
  echo "ERROR: dist/index.js missing after build" >&2
  exit 1
fi

tar czf "${OUT}" \
  --transform 's,^,package/,' \
  --exclude='*.test.ts' \
  --exclude='node_modules' \
  --exclude='*.tgz' \
  --exclude='test' \
  --exclude='.pack.sh' \
  openclaw.plugin.json package.json tsconfig.json dist/ src/ skills/

echo
echo "Built: $(pwd)/${OUT} ($(du -h "${OUT}" | cut -f1))"
echo
echo "--- contents ---"
tar tzf "${OUT}"
