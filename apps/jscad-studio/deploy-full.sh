#!/bin/bash
# Deploy the full studio: frontend, then API, then the run host, then health
# and smoke. Mirrors checklist's deploy-full.sh.
#
# Usage: ./deploy-full.sh [test|prod] [init|update]
#
# Environments:
#   test (default):
#     - jscad-studio-test.rkroll.com      -> frontend + API
#     - run.jscad-studio-test.rkroll.com  -> compute frame
#   prod:
#     - jscad-studio.rkroll.com           -> frontend + API
#     - run.jscad-studio.rkroll.com       -> compute frame
#
# The test domains must resolve before the first test deploy; DNS for them
# does not exist yet. Nothing here provisions DNS.

set -e

ENV="${1:-test}"
MODE="${2:-update}"

if [[ "$ENV" != "prod" && "$ENV" != "test" ]]; then
    echo "Usage: $0 [test|prod] [init|update]"
    exit 1
fi

DEPLOY_SH="../../deploy.sh/deploy.sh"

if [[ "$ENV" == "prod" ]]; then
    export APP_PORT="${APP_PORT:-3001}"
    export DOMAIN_NAME="jscad-studio.rkroll.com"
    export REMOTE_HOST="jscad-studio.rkroll.com"
    export RUN_DOMAIN_NAME="run.jscad-studio.rkroll.com"
    export RUN_REMOTE_HOST="run.jscad-studio.rkroll.com"
    export APP_URL="https://jscad-studio.rkroll.com"
else
    export APP_PORT="${APP_PORT:-3002}"
    export DOMAIN_NAME="jscad-studio-test.rkroll.com"
    export REMOTE_HOST="jscad-studio-test.rkroll.com"
    export RUN_DOMAIN_NAME="run.jscad-studio-test.rkroll.com"
    export RUN_REMOTE_HOST="run.jscad-studio-test.rkroll.com"
    export APP_URL="https://jscad-studio-test.rkroll.com"
fi

echo "=== jscad-studio Full Deployment ==="
echo "Environment: $ENV ($APP_URL)"
echo "Mode: $MODE"
echo ""

echo "[1/4] Deploying Frontend..."
"$DEPLOY_SH" "$MODE" .
echo "✓ Frontend deployed ($APP_URL)"
echo ""

echo "[2/4] Deploying API..."
cd server
"../../../deploy.sh/deploy.sh" "$MODE" .
cd ..
echo "✓ API deployed"
echo ""

echo "[3/4] Deploying Run Host..."
cd ../jscad-studio-run
DOMAIN_NAME="$RUN_DOMAIN_NAME" REMOTE_HOST="$RUN_REMOTE_HOST" \
    "../../deploy.sh/deploy.sh" "$MODE" .
cd ../jscad-studio
echo "✓ Run host deployed"
echo ""

echo "[4/4] Health check + smoke test..."
sleep 3
if curl -sf "$APP_URL/api/health" > /dev/null; then
    echo "✓ Backend health check passed"
else
    echo "✗ Backend health check FAILED"
    exit 1
fi

APP_URL="$APP_URL" node e2e/smoke-deploy.mjs
echo ""
echo "=== Deployment Complete ==="
echo "App: $APP_URL"
