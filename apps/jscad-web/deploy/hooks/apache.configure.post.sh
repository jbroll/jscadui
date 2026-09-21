#!/bin/bash
# apache.configure.post.sh — installs the compute frame's headers.
#
# Shared by apps/jscad-web's app and run deploy.conf/deploy-run.conf (both
# read hooks from this project's deploy/hooks). Each host installs its own
# block, keyed by APP_NAME, idempotently — a marker comment bounds each
# block, so a re-deploy replaces rather than duplicates it.
#
# Runs locally after the apache configure stage with APP_NAME, DOMAIN_NAME
# and REMOTE_HOST/REMOTE_USER from deploy.conf/deploy-run.conf.
set -e
source "$DEPLOY_HOME/lib/common.sh"

VHOST="/etc/apache2/sites-available/${APP_NAME}.conf"

if [[ "$APP_NAME" == "jscad-run" ]]; then
  # The run host serves the frame at its document root, so these headers are
  # vhost-wide, not path-scoped. The stock APACHE_SECURITY_HEADERS block (off
  # here) has no CORS support, and the blob worker's bundle XHRs are
  # cross-origin fetches from the frame's opaque origin even same-host.
  MARKER="jscad-web frame headers"
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
elif [[ "$APP_NAME" == "jscad-web" ]]; then
  # A model running in the frame reads an example's sibling files and
  # OpenSCAD includes from this host over a cross-origin fetch — the frame's
  # Origin header is the opaque string "null", which only "*" matches. No
  # Allow-Credentials: it is incompatible with "*" and would undo the
  # boundary. The requests are GET with no custom headers and no
  # credentials, so they are simple requests and draw no preflight, so no
  # Allow-Methods/-Headers are needed. Scoped to /examples/, the static
  # paths the frame can name, so /api/ never gets a vhost-wide grant — the
  # API and relay deliberately reject a null origin, and a wider header
  # would make their responses readable from inside the sandbox. "always"
  # so a missing sibling's 404 carries the header too, not just a 200.
  MARKER="jscad-web example CORS headers"
  BLOCK=$(cat <<EOF | base64 -w0
    # jscad-web example CORS headers (managed by deploy hook; do not edit)
    <LocationMatch "^/examples/">
        Header always set Access-Control-Allow-Origin "*"
    </LocationMatch>
    # end jscad-web example CORS headers
EOF
)
else
  exit 0
fi

INSTALLER=$(cat <<'PYEOF' | base64 -w0
import re, sys
path, block_path, marker = sys.argv[1], sys.argv[2], sys.argv[3]
with open(block_path) as f:
    block = f.read()
with open(path) as f:
    text = f.read()
start = '    # %s' % marker
end = '    # end %s\n' % marker
text = re.sub(re.escape(start) + '.*?' + re.escape(end), '', text, flags=re.S)
text, count = re.subn(r'(</VirtualHost>)(?!.*</VirtualHost>)', block + r'\1', text, flags=re.S)
if count != 1:
    sys.exit('expected exactly one VirtualHost close, found %d' % count)
with open(path, 'w') as f:
    f.write(text)
PYEOF
)

info "Installing $MARKER into $VHOST on $REMOTE_HOST"
ssh "${REMOTE_USER}@${REMOTE_HOST}" \
  "echo '$BLOCK' | base64 -d > /tmp/${APP_NAME}-frame-headers.txt && " \
  "echo '$INSTALLER' | base64 -d > /tmp/${APP_NAME}-install-headers.py && " \
  "sudo python3 /tmp/${APP_NAME}-install-headers.py '$VHOST' /tmp/${APP_NAME}-frame-headers.txt '$MARKER' && " \
  "rm /tmp/${APP_NAME}-frame-headers.txt /tmp/${APP_NAME}-install-headers.py && " \
  "sudo apache2ctl configtest && " \
  "(sudo systemctl reload apache2 || sudo service apache2 reload)"
