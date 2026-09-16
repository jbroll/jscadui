#!/bin/bash
# apache.configure.post.sh — installs the compute frame's security headers.
#
# The stock APACHE_SECURITY_HEADERS block stays off for this vhost: it emits
# X-Frame-Options: SAMEORIGIN (which would forbid the app origin from embedding
# the frame) and carries no CSP. This hook writes the frame-ancestors CSP plus
# Permissions-Policy into the vhost, idempotently — a marker comment bounds the
# block, so re-deploys replace rather than duplicate it.
#
# Runs locally after the apache configure stage with APP_NAME, DOMAIN_NAME and
# REMOTE_HOST/REMOTE_USER from deploy.conf. APP_ORIGIN is the app origin for
# this environment (DOMAIN_NAME is run.* of the apex that serves the app).
set -e
source "$DEPLOY_HOME/lib/common.sh"

APP_ORIGIN="https://jscad.rkroll.com"
case "$DOMAIN_NAME" in
  run.jscad-studio-test.rkroll.com) APP_ORIGIN="https://jscad-studio-test.rkroll.com" ;;
  run.jscad-studio.rkroll.com) APP_ORIGIN="https://jscad-studio.rkroll.com" ;;
  jscad-run.rkroll.com) APP_ORIGIN="https://jscad.rkroll.com" ;;
esac
RUN_ORIGIN="https://$DOMAIN_NAME"
VHOST="/etc/apache2/sites-available/${APP_NAME}.conf"

BLOCK=$(cat <<EOF | base64 -w0
    # jscad-studio frame headers (managed by deploy hook; do not edit)
    Header always set Content-Security-Policy "default-src 'none'; script-src $RUN_ORIGIN https://cdn.jsdelivr.net blob: 'unsafe-eval'; connect-src $RUN_ORIGIN https://cdn.jsdelivr.net; worker-src blob: $RUN_ORIGIN; frame-ancestors $APP_ORIGIN"
    Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), usb=(), serial=()"
    # end jscad-studio frame headers
EOF
)

INSTALLER=$(cat <<'PYEOF' | base64 -w0
import re, sys
path, block_path = sys.argv[1], sys.argv[2]
with open(block_path) as f:
    block = f.read()
with open(path) as f:
    text = f.read()
text = re.sub(r'    # jscad-studio frame headers.*?    # end jscad-studio frame headers\n', '', text, flags=re.S)
text, count = re.subn(r'(</VirtualHost>)(?!.*</VirtualHost>)', block + r'\1', text, flags=re.S)
if count != 1:
    sys.exit('expected exactly one VirtualHost close, found %d' % count)
with open(path, 'w') as f:
    f.write(text)
PYEOF
)

info "Installing frame headers into $VHOST on $REMOTE_HOST (frame-ancestors $APP_ORIGIN)"
ssh "${REMOTE_USER}@${REMOTE_HOST}" \
  "echo '$BLOCK' | base64 -d > /tmp/${APP_NAME}-frame-headers.txt && " \
  "echo '$INSTALLER' | base64 -d > /tmp/${APP_NAME}-install-headers.py && " \
  "sudo python3 /tmp/${APP_NAME}-install-headers.py '$VHOST' /tmp/${APP_NAME}-frame-headers.txt && " \
  "rm /tmp/${APP_NAME}-frame-headers.txt /tmp/${APP_NAME}-install-headers.py && " \
  "sudo apache2ctl configtest && " \
  "(sudo systemctl reload apache2 || sudo service apache2 reload)"
