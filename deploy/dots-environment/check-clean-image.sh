#!/usr/bin/env bash
# Presence-only snapshot guard. Never reads, relocates or deletes authentication.
set -euo pipefail
binary_cache_only() (
  local directory="$1" entry
  [[ -d "$directory" && ! -L "$directory" ]] || return 1
  shopt -s nullglob dotglob
  for entry in "$directory"/*; do
    [[ "$entry" == "$directory/bin" && -d "$entry" && ! -L "$entry" ]] || return 1
  done
)
reject_auth() {
  echo 'snapshot-has-personal-auth: prepare a fresh environment before publishing' >&2
  exit 1
}
if [[ -e "$HOME/.oddbout/auth" || -L "$HOME/.oddbout/auth" ]]; then reject_auth; fi
if [[ -e "$HOME/.grok" || -L "$HOME/.grok" ]]; then
  # Official grok --version can create only this binary cache before any login.
  # Unknown entries, hidden files and symlinks still require a fresh image.
  if ! binary_cache_only "$HOME/.grok"; then reject_auth; fi
fi
if [[ "${GROK_HOME+x}" ]]; then
  [[ -n "$GROK_HOME" && "$GROK_HOME" = /* ]] || reject_auth
  if [[ -e "$GROK_HOME" || -L "$GROK_HOME" ]]; then
    if ! binary_cache_only "$GROK_HOME"; then reject_auth; fi
  fi
fi
user_account="${AI_FIGHTER_ROOT:-/workspace/oddbout-workspace}/.oddbout-private/grok-account"
if [[ -e "$user_account" || -L "$user_account" ]]; then reject_auth; fi
if [[ -n "${XAI_API_KEY:-}${OPENAI_API_KEY:-}${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo 'snapshot-has-service-keys: remove injected secrets before preparing the image' >&2
  exit 1
fi
