#!/usr/bin/env bash
# Run once in a fresh Debian/Ubuntu saved environment, as its eventual workspace user.
set -euo pipefail
umask 077
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
tools_dir="${ODDBOUT_TOOLS_HOME:-/workspace/.oddbout-tools}"
runtime_home="${ODDBOUT_RUNTIME_HOME:-/workspace/.oddbout/runtimes}"
workspace="${AI_FIGHTER_ROOT:-/workspace/oddbout-workspace}"
bash "$repo/deploy/dots-environment/check-clean-image.sh"
if [[ "$(uname -s)" != Linux ]]; then echo 'saved-linux-vm-required' >&2; exit 1; fi
# Managed Dots VMs already provide these tools and may have neither root nor sudo.
# Reuse the base image when it is usable; Node, Grok and WebP install in workspace-owned folders.
check_base_tools() {
  missing=()
  for tool in curl git xz tar sha256sum; do
    if ! command -v "$tool" >/dev/null || ! "$tool" --version >/dev/null 2>&1; then missing+=("$tool"); fi
  done
  for tool in ffmpeg ffprobe; do
    if ! command -v "$tool" >/dev/null || ! "$tool" -version >/dev/null 2>&1; then missing+=("$tool"); fi
  done
  if ! python3 -c 'import sys,ssl,venv,ensurepip; assert sys.version_info >= (3,11)' >/dev/null 2>&1; then
    missing+=(python3.11-with-ssl-venv-ensurepip)
  fi
}
check_base_tools
if (( ${#missing[@]} )); then
  if ! command -v apt-get >/dev/null; then
    printf 'base-tools-required: %s; ask the environment preparer for a supported base image\n' "${missing[*]}" >&2; exit 1
  fi
  if [[ $(id -u) == 0 ]]; then as_root=()
  elif command -v sudo >/dev/null && sudo -n true 2>/dev/null; then as_root=(sudo -n)
  else
    printf 'base-tools-required: %s; no supported package-install permission\n' "${missing[*]}" >&2; exit 1
  fi
  "${as_root[@]}" apt-get update
  "${as_root[@]}" apt-get install -y --no-install-recommends ca-certificates curl git xz-utils python3 python3-venv python3-pip ffmpeg
  check_base_tools
  if (( ${#missing[@]} )); then printf 'base-tools-required-after-install: %s\n' "${missing[*]}" >&2; exit 1; fi
else
  printf '%s\n' 'Base tools verified; reusing the managed image without system package changes.'
fi
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
export npm_config_cache="$tools_dir/npm-cache"
export PIP_CACHE_DIR="$tools_dir/pip-cache"
mkdir -p "$tools_dir/grok" "$npm_config_cache" "$PIP_CACHE_DIR"
cp "$repo/deploy/dots-environment/package.json" "$repo/deploy/dots-environment/package-lock.json" "$tools_dir/grok/"
npm ci --prefix "$tools_dir/grok" --ignore-scripts --omit=dev --no-audit --no-fund
# The unmodified official launcher supports in-package extraction on an unwritable home.
# Never relocate HOME/GROK_HOME or copy authentication to install the executable.
grok_version="$(grok --version)"
[[ "$grok_version" == "grok 1.0.70 "* ]] || { echo 'grok-version-mismatch' >&2; exit 1; }
printf '%s\n' "$grok_version"
ffmpeg -version >/dev/null
ffprobe -version >/dev/null
release_commit="$(node -e 'const fs=require("node:fs"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!/^[a-f0-9]{40}$/.test(r.commit))process.exit(1); process.stdout.write(r.commit)' "$repo/deploy/dots-release.json")"
# Keep ordinary post-processing tools out of the read-only home and personal auth storage.
export SPRITE_GEN_DATA_DIR="$tools_dir/sprite-gen-data/$release_commit"
printf 'export PATH=%q:$PATH\n' "$node_dir/bin:$tools_dir/grok/node_modules/.bin" > "$tools_dir/env.sh"
printf 'export ODDBOUT_RUNTIME_HOME=%q\nexport AI_FIGHTER_ROOT=%q\n' "$runtime_home" "$workspace" >> "$tools_dir/env.sh"
printf 'export npm_config_cache=%q\nexport PIP_CACHE_DIR=%q\n' "$npm_config_cache" "$PIP_CACHE_DIR" >> "$tools_dir/env.sh"
printf 'export SPRITE_GEN_DATA_DIR=%q\n' "$SPRITE_GEN_DATA_DIR" >> "$tools_dir/env.sh"
cd "$repo"
# Install the immutable release into the saved workspace. The kit installs pinned WebP if the OS copy lacks -exact. No login or generation.
# Each release gets its own preparation receipt. Never rewrite an older binding.
template_workspace="/workspace/.oddbout-template-workspaces/$release_commit"
node dots.mjs --install --runtime-home "$runtime_home" --workspace "$template_workspace"
# Dots bootstrap deliberately skips this optional source-development dependency. The saved
# production image prepares it explicitly: official pinned download plus actual check frame.
# A missing/broken execution device must fail preparation, never silently select nearest frames.
(
  cd "$runtime_home/$release_commit"
  node scripts/sprite-gen.mjs rife install
)
printf '%s\n' 'Tools prepared. Review docs/DOTS-START.md, publish without user data, then connect the user in the running VM.'
