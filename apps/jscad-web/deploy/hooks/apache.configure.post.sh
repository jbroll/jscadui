#!/bin/bash
# apache.configure.post.sh — installs the compute frame's headers.
#
# Shared by apps/jscad-web's app and run deploy.conf/deploy-run.conf (both
# read hooks from this project's deploy/hooks). Inert for the app deploy;
# only the run host (APP_NAME=jscad-run) needs these headers.
[[ "$APP_NAME" == "jscad-run" ]] || exit 0
#
# The run host serves the frame at its document root, so these headers are
# vhost-wide, not path-scoped. The stock APACHE_SECURITY_HEADERS block (off
# here) has no CORS support, and the blob worker's bundle XHRs are
# cross-origin fetches from the frame's opaque origin even same-host. This
# hook writes the block into the vhost, idempotently — a marker comment
# bounds the block, so re-deploys replace rather than duplicate it.
#
# Runs locally after the apache configure stage with APP_NAME, DOMAIN_NAME
# and REMOTE_HOST/REMOTE_USER from deploy-run.conf.
set -e
source "$DEPLOY_HOME/lib/common.sh"

VHOST="/etc/apache2/sites-available/${APP_NAME}.conf"

BLOCK=$(cat <<EOF | base64 -w0
    # jscad-web frame headers (managed by deploy hook; do not edit)
    # CORS: the sandboxed frame has an opaque origin, so its module script
    # and the worker's bundle XHRs are cross-origin fetches that need this.
    # frame-ancestors allows only the app origin to embed this frame.
    Header always set Access-Control-Allow-Origin "*"
    Header always set Content-Security-Policy "frame-ancestors https://jscad.rkroll.com"
    Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), usb=(), serial=()"
    # end jscad-web frame headers
EOF
)

INSTALLER=$(cat <<'PYEOF' | base64 -w0
import re, sys
path, block_path = sys.argv[1], sys.argv[2]
with open(block_path) as f:
    block = f.read()
with open(path) as f:
    text = f.read()
text = re.sub(r'    # jscad-web frame headers.*?    # end jscad-web frame headers\n', '', text, flags=re.S)
text, count = re.subn(r'(</VirtualHost>)(?!.*</VirtualHost>)', block + r'\1', text, flags=re.S)
if count != 1:
    sys.exit('expected exactly one VirtualHost close, found %d' % count)
with open(path, 'w') as f:
    f.write(text)
PYEOF
)

info "Installing frame headers into $VHOST on $REMOTE_HOST"
ssh "${REMOTE_USER}@${REMOTE_HOST}" \
  "echo '$BLOCK' | base64 -d > /tmp/${APP_NAME}-frame-headers.txt && " \
  "echo '$INSTALLER' | base64 -d > /tmp/${APP_NAME}-install-headers.py && " \
  "sudo python3 /tmp/${APP_NAME}-install-headers.py '$VHOST' /tmp/${APP_NAME}-frame-headers.txt && " \
  "rm /tmp/${APP_NAME}-frame-headers.txt /tmp/${APP_NAME}-install-headers.py && " \
  "sudo apache2ctl configtest && " \
  "(sudo systemctl reload apache2 || sudo service apache2 reload)"
