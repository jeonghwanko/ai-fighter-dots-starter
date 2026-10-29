#!/usr/bin/env bash
# One-time root setup of the official host (ODDBOUT's own generation PC). From the folder holding these files, as the operator:
#   sudo bash install-service-user.sh
# Creates the service user whose HOME holds the dedicated GPT/Grok logins and which cannot read the operator's home,
# gives it its own node and a user systemd (linger, for the memory slice), and lets the operator run exactly one
# program as it without a password: the service copy of og. Safe to run again; it refreshes the files it installs.
set -euo pipefail

die() { echo "install: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run with sudo"
OPERATOR=${SUDO_USER:-}
[ -n "$OPERATOR" ] && [ "$OPERATOR" != root ] || die "run through sudo from the operator account"
SVC=oddbout-gen
G=/srv/oddbout-gen
OP_HOME=$(getent passwd "$OPERATOR" | cut -d: -f6)
NODE_SRC=${NODE_SRC:-$OP_HOME/.fnm/node-versions/v22.22.2/installation}
HERE=$(cd "$(dirname "$0")" && pwd)
FILES=(og ledger-report.mjs ledger-report.test.mjs)

[ -x "$NODE_SRC/bin/node" ] || die "no node at $NODE_SRC (set NODE_SRC)"
for f in "${FILES[@]}"; do [ -f "$HERE/$f" ] || die "missing $HERE/$f"; done

getent passwd "$SVC" >/dev/null ||
  useradd --system --user-group --home-dir "$G" --create-home --shell /usr/sbin/nologin "$SVC"
[ "$(getent passwd "$SVC" | cut -d: -f6)" = "$G" ] || die "$SVC exists with another home"
chmod 750 "$G"
# The operator reads deliveries; the service user is NOT added to the operator's group.
usermod -aG "$SVC" "$OPERATOR"
id -nG "$SVC" | grep -qw "$OPERATOR" && die "$SVC must not be in the $OPERATOR group"

install -d -o "$SVC" -g "$SVC" -m 750 "$G/bin" "$G/deliveries"
for f in "${FILES[@]}"; do sed 's/\r$//' "$HERE/$f" >"$G/bin/$f"; done
chown "$SVC:$SVC" "$G/bin"/*; chmod 750 "$G/bin/og"; chmod 640 "$G/bin"/*.mjs
bash -n "$G/bin/og"

rm -rf "$G/node.new"; cp -a "$NODE_SRC" "$G/node.new"; chown -R "$SVC:$SVC" "$G/node.new"
rm -rf "$G/node"; mv "$G/node.new" "$G/node"

loginctl enable-linger "$SVC"

rule=/etc/sudoers.d/oddbout-gen
printf '%s ALL=(%s) NOPASSWD: %s\n' "$OPERATOR" "$SVC" "$G/bin/og" >"$rule.tmp"
chmod 440 "$rule.tmp"
visudo -cf "$rule.tmp" >/dev/null || { rm -f "$rule.tmp"; die "sudoers rule did not validate"; }
mv "$rule.tmp" "$rule"

# The operator's copy: reads the operator's own identities, then sudo-runs the service copy.
ops=$OP_HOME/.local/share/oddbout-gen-ops
install -d -o "$OPERATOR" -g "$OPERATOR" "$ops" "$OP_HOME/.local/bin"
for f in "${FILES[@]}"; do sed 's/\r$//' "$HERE/$f" >"$ops/$f"; done
chown "$OPERATOR:$OPERATOR" "$ops"/*; chmod 755 "$ops/og"
ln -sfn "$ops/og" "$OP_HOME/.local/bin/og"; chown -h "$OPERATOR:$OPERATOR" "$OP_HOME/.local/bin/og"

echo "install: done. $SVC home $G, operator $OPERATOR (log out and back in once for the new group)."
echo "install: next, as $OPERATOR:  og setup  →  og login codex  →  og login grok  →  og health"
