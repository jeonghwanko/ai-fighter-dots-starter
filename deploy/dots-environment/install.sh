#!/usr/bin/env bash
# Run once in a fresh Debian/Ubuntu saved environment, as its eventual workspace user.
set -euo pipefail
umask 077
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
tools_dir="$HOME/.local/share/oddbout-tools"
for credential_dir in "$HOME/.grok" "$HOME/.oddbout/auth"; do
  if [[ -e "$credential_dir" ]]; then
    echo 'snapshot-has-personal-auth: prepare a fresh environment before publishing' >&2; exit 1
  fi
done
if [[ -n "${XAI_API_KEY:-}${OPENAI_API_KEY:-}${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo 'snapshot-has-service-keys: remove injected secrets before preparing the image' >&2; exit 1
fi
if [[ "$(uname -s)" != Linux ]]; then echo 'saved-linux-vm-required' >&2; exit 1; fi
if [[ $(id -u) == 0 ]]; then as_root=(); else as_root=(sudo -n); fi
"${as_root[@]}" apt-get update
"${as_root[@]}" apt-get install -y --no-install-recommends ca-certificates curl git xz-utils python3 python3-venv python3-pip ffmpeg webp
python3 -c 'import sys; assert sys.version_info >= (3,11), "python-3.11-required-use-a-newer-base-image"'
case "$(uname -m)" in
  x86_64) arch=x64; checksum=88fd1ce767091fd8d4a99fdb2356e98c819f93f3b1f8663853a2dee9b438068a ;;
  aarch64) arch=arm64; checksum=e9e1930fd321a470e29bb68f30318bf58e3ecb4acb4f1533fb19c58328a091fe ;;
  *) echo 'unsupported-linux-architecture' >&2; exit 1 ;;
esac
node_dir="$tools_dir/node-v22.22.2-linux-$arch"
mkdir -p "$tools_dir"
if [[ ! -x "$node_dir/bin/node" ]]; then
  archive="$tools_dir/node-v22.22.2-linux-$arch.tar.xz"
  curl --fail --silent --show-error --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v22.22.2/node-v22.22.2-linux-$arch.tar.xz" -o "$archive"
  printf '%s  %s\n' "$checksum" "$archive" | sha256sum -c -
  tar -xJf "$archive" -C "$tools_dir"
fi
export PATH="$node_dir/bin:$tools_dir/grok/node_modules/.bin:$PATH"
[[ "$(node --version)" == v22.22.2 ]] || { echo 'node-version-mismatch' >&2; exit 1; }
mkdir -p "$tools_dir/grok"
cp "$repo/deploy/dots-environment/package.json" "$repo/deploy/dots-environment/package-lock.json" "$tools_dir/grok/"
npm ci --prefix "$tools_dir/grok" --omit=dev --no-audit --no-fund
grok --version
ffmpeg -version >/dev/null
ffprobe -version >/dev/null
img2webp -h 2>&1 | grep -q -- '-exact'
printf 'export PATH="%s/bin:%s/grok/node_modules/.bin:$PATH"\n' "$node_dir" "$tools_dir" > "$tools_dir/env.sh"
cd "$repo"
# Install the immutable release into the eventual user's runtime home. No login or generation.
node dots.mjs --install --workspace "$HOME/.oddbout/template-workspace"
printf '%s\n' 'Tools prepared. Review docs/DOTS-START.md, publish without user data, then connect the user in the running VM.'
