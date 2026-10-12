#!/bin/sh
# Render build script for the AKSA web preview (static site).
# Installs dependencies, runs the test suite as a build gate, and
# exports the app as a static web bundle into dist/ (expo-router
# static rendering, per app.json "web.output": "static").
set -e

echo "==> Node $(node --version), npm $(npm --version)"

if [ -f package-lock.json ]; then
  echo "==> Installing dependencies (npm ci)"
  npm ci
else
  echo "==> Installing dependencies (npm install)"
  npm install
fi

echo "==> Typecheck"
npm run typecheck

echo "==> Unit + golden tests"
npm test -- --ci

echo "==> Exporting static web bundle to dist/"
npx expo export --platform web

echo "==> Build complete"