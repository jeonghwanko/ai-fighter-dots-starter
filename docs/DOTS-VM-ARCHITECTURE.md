# Dots VM creation path

The supported product path is Dots orchestration with **the user's Grok subscription on a saved Linux VM**.
Images, video, extraction, review artifacts and packaging run in that VM. A local PC or parent-container
execution is not an acceptance-test substitute. Codex rollout scraping and API-key fallback are excluded.

## One entry point

The repository front door carries a release descriptor with the exact Git source commit and version.
`node dots.mjs --install` fetches that commit once and delegates to `dots:start`, which binds a
workspace to it, then checks and resumes that same workspace. The agent handles commands after receiving
the repository URL and the user's creation request. Merely sharing a URL never starts generation.
An active workspace retains its original release. A newer front-door revision cannot silently migrate it.
For source bundles, the separate existing manifest SHA-256 trust anchor remains required. The descriptor
labels release-candidate VM acceptance explicitly; pinning a commit is integrity, not proof of creation.

## Saved environment

The environment preparer installs Node 22.12+, Python 3.11+ with venv, Git, ffmpeg/ffprobe, exact-alpha
WebP tools, the pinned sprite engine and the selected Grok CLI before publishing the environment.
Its Start instructions run the entry point against the user's persistent workspace. Credentials, personal
source files and generation attempts never enter the published image. First use connects only that user's
Grok subscription through its supported device login. Expiry requests reconnection, never a billing switch.

## Separate checks, one next action

The check result separates installation, subscription credential availability, image/video capability,
VM file receipt, conversation display, recovery and ODDBOUT registration. It selects one next action:
repair the environment, connect Grok, receive a source, reconcile an unknown attempt, show a preview,
or continue the next creation group. Credential presence never certifies entitlement or generation.
The first authorized output supplies live generation evidence; a readiness check never generates a test image.

## Private source transport

Official host file inputs enter the existing authenticated ODDBOUT connector. Server-measured size/hash
bind immutable per-owner source records in a private bucket; retries use the same idempotency key.
The VM creates a local temporary keypair and exposes only its public request. The connector authorizes
the source for that account and seals a short-lived download grant to that VM key. The signed URL and
private key never appear in chat, command arguments or normal logs. The VM decrypts locally, permits only
the exact configured storage origin, downloads without redirects, verifies bytes/hash and fully decodes
the PNG before atomically admitting it to the workspace. Expiry renews a grant for the same source.
This route is for authorized file transport, not an alternate network-policy bypass.

## Private preview persistence

A supported Pages host file input can persist VM previews in an owner-only personal review Page.
The agent verifies upload size/hash and file_access_confirmed, inserts the returned native reference,
and inspects the rendered Page. The target conversation can read that same reference through its
supported Page-file tool. This preserves originals across chats without public URLs or credentials.
A Page render is not automatically a current-conversation render; record both observations and verify
animation playback separately. See DOTS-PRIVATE-SOURCES.md for the exact host-tool workflow.

## Creation and resume

Persist the brief, Grok route, selected versions, original pixels, request IDs, outcomes, reviews and
delivery receipts under one workspace. Every invocation reads recovery records before installation or
dispatch. An unknown generation outcome is reconciled with the original job; it is never automatically
resubmitted. Complete each agreed review group and return actual VM previews to the original conversation.
All eleven motions, measured gait and final package validation remain required for a fighter.

## Acceptance evidence

1. Fresh saved VM: the repository front door selects one pinned release and reuses installed tools.
2. No credentials: one Grok device-login action; no API request or generated image.
3. Existing PNG: native file input → private storage → VM bytes and decode; another owner is denied.
4. Restart: recover the same workspace and bytes; expired transfer grants renew without a new source.
5. Authorized Grok creation: actual request/output traces, original files, group previews and user review.
6. Completion: eleven motions, pixel-bound gait review, game-pack and fighter validation; registration only
   after the user's final registration request. Local mocks, file-only checks and direct parent generation
   are reported separately from this end-to-end result.
