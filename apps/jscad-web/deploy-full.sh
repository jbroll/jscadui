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

# An inherited REMOTE_HOST turns every deploy.sh stage into a silent no-op
# (see the stage comment below). Each stage takes its host from its own config.
unset REMOTE_HOST

MODE="${1:-update}"

DEPLOY_SH="../../../deploy.sh/deploy.sh"

export APP_PORT="${APP_PORT:-3006}"
APP_DOMAIN="jscad.rkroll.com"
APP_URL="https://${APP_DOMAIN}"
RUN_DOMAIN="jscad-run.rkroll.com"
RUN_URL="https://${RUN_DOMAIN}"

# A freshly deployed vhost needs a moment. curl -f exits non-zero on anything
# but a 2xx, so its status is the check; the body is never read.
wait_for_ok() {
    local url="$1" name="$2" tries=15
    for ((i = 1; i <= tries; i++)); do
        if curl -sf -o /dev/null --max-time 5 "$url"; then
            echo "✓ $name responding"
            return 0
        fi
        sleep 1
    done
    echo "✗ $name FAILED to respond after ${tries} tries"
    return 1
}

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

# Each stage gets its hostname from its own config, and nothing exports
# REMOTE_HOST into a stage that is not its own: deploy.sh sources lib/platform.sh
# from common.sh before it reads the config, and an inherited REMOTE_HOST makes
# that run remote detection over ssh and end the script with status 0 — a silent
# no-op that reads as success.
echo "[1/4] Deploying compute frame host..."
DEPLOY_SH_CONF="$(pwd)/deploy-run.conf" APP_URL="$RUN_URL" "$DEPLOY_SH" "$MODE" .
echo "✓ Frame host deployed ($RUN_URL)"
echo ""

echo "Checking frame host is up before deploying the app..."
wait_for_ok "$RUN_URL/" "Frame host"
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
wait_for_ok "$APP_URL/api/health" "Backend health check"

node e2e/smoke-deploy.mjs --url "$APP_URL" --build build --frame-url "$RUN_URL"
echo ""
echo "=== Deployment Complete ==="
echo "App: $APP_URL"
echo "Frame: $RUN_URL"
