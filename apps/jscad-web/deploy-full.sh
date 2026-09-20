#!/bin/bash
# Deploy the full app: frontend (with integral /frame/), then API, then
# health and smoke. Successor of the retired jscad-studio/deploy-full.sh.
# The compute frame needs no step of its own: it builds and ships inside the
# frontend (build/frame/). Retire the run.* vhosts/DNS as an operator step
# once this deploy is verified.
#
# Usage: ./deploy-full.sh [update|init]
#
# Environment (prod only):
#   - jscad.rkroll.com      -> frontend + /frame/ + API
#
# A test domain is not provisioned yet; do not re-add the old
# jscad-studio-test hostnames (their DNS never existed).

set -e

MODE="${1:-update}"

DEPLOY_SH="../../../deploy.sh/deploy.sh"

export APP_PORT="${APP_PORT:-3006}"
export DOMAIN_NAME="jscad.rkroll.com"
export REMOTE_HOST="jscad.rkroll.com"
export APP_URL="https://jscad.rkroll.com"

echo "=== jscad-web Full Deployment ==="
echo "App: $APP_URL"
echo "Mode: $MODE"
echo ""

echo "[1/3] Deploying Frontend..."
"$DEPLOY_SH" "$MODE" .
echo "✓ Frontend deployed ($APP_URL)"
echo ""

echo "[2/3] Deploying API..."
cd server
"../../../../deploy.sh/deploy.sh" "$MODE" .
cd ..
echo "✓ API deployed"
echo ""

echo "[3/3] Health check + smoke test..."
sleep 3
if curl -sf "$APP_URL/api/health" > /dev/null; then
    echo "✓ Backend health check passed"
else
    echo "✗ Backend health check FAILED"
    exit 1
fi
curl -sf "$APP_URL/frame/" > /dev/null && echo "✓ Frame page served" || { echo "✗ Frame page FAILED"; exit 1; }

APP_URL="$APP_URL" node e2e/smoke-deploy.mjs
echo ""
echo "=== Deployment Complete ==="
echo "App: $APP_URL"
