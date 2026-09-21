#!/bin/bash
# Deploy the full app: compute frame host, then frontend, then API, then
# health and smoke. Successor of the retired jscad-studio/deploy-full.sh.
# The frame is its own origin (jscad-run.rkroll.com, deploy-run.conf) and
# must be up before the frontend: the app has no engine without it.
#
# Usage: ./deploy-full.sh [update|init]
#
# Environment (prod only):
#   - jscad-run.rkroll.com  -> compute frame (sandboxed, static)
#   - jscad.rkroll.com      -> frontend + API
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
RUN_DOMAIN="jscad-run.rkroll.com"
RUN_URL="https://${RUN_DOMAIN}"

echo "=== jscad-web Full Deployment ==="
echo "App: $APP_URL"
echo "Frame: $RUN_URL"
echo "Mode: $MODE"
echo ""

# Both hosts ship out of build/, and the run host's own APACHE_BUILD_CMD never
# fires (the apache module only runs it when APACHE_CONTENT_DIR has a
# package.json, and build/frame has none). Build once, here, before either.
echo "[0/4] Building the workspace..."
npm --prefix ../.. install --no-audit --no-fund
npm run build
echo "✓ Build complete"
echo ""

# deploy.sh sources the project config into this inherited environment, and
# deploy-run.conf reads DOMAIN_NAME/REMOTE_HOST as ${VAR:-jscad-run...} — so
# the app's exports above would win and put the frame on the app's hostname.
echo "[1/4] Deploying compute frame host..."
DEPLOY_SH_CONF="$(pwd)/deploy-run.conf" \
    DOMAIN_NAME="$RUN_DOMAIN" REMOTE_HOST="$RUN_DOMAIN" APP_URL="$RUN_URL" \
    "$DEPLOY_SH" "$MODE" .
echo "✓ Frame host deployed ($RUN_URL)"
echo ""

echo "Checking frame host is up before deploying the app..."
sleep 3
if curl -sf -o /dev/null -w '%{http_code}' "$RUN_URL/" | grep -q '^200$'; then
    echo "✓ Frame host responding"
else
    echo "✗ Frame host FAILED to respond with 200"
    exit 1
fi
echo ""

echo "[2/4] Deploying Frontend..."
"$DEPLOY_SH" "$MODE" .
echo "✓ Frontend deployed ($APP_URL)"
echo ""

echo "[3/4] Deploying API..."
cd server
"../../../../deploy.sh/deploy.sh" "$MODE" .
cd ..
echo "✓ API deployed"
echo ""

echo "[4/4] Health check + smoke test..."
sleep 3
if curl -sf "$APP_URL/api/health" > /dev/null; then
    echo "✓ Backend health check passed"
else
    echo "✗ Backend health check FAILED"
    exit 1
fi

node e2e/smoke-deploy.mjs --url "$APP_URL"
echo ""
echo "=== Deployment Complete ==="
echo "App: $APP_URL"
echo "Frame: $RUN_URL"
