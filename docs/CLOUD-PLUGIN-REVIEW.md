# ODDBOUT cloud plugin review

Status on 2026-10-24: **draft created; not submitted for review**. This remote
MCP submission is independent of the local MCP partner eligibility case.

## Draft and package

- Portal: https://platform.openai.com/plugins/manage/plugin_asdk_app_6adc53c4d8b48191ab5ffbf0ef1655c6
- Initial uploaded draft: `appsub_6adc53c4d8e88191b5c676beb2f61602`, version 1.0.0.
- Publisher selected in the portal: verified individual **정환 고**.
- Source: `plugins/oddbout-cloud/`. Version 1.0.1 changes the MCP address to the
  verified-origin-capable public entry point. Its ZIP has been prepared locally
  but has not yet been uploaded to this draft.
- Metadata contains five proposed positive and three negative review cases.
  These are review plans, not evidence that a dedicated reviewer account has run them.
- The dedicated reviewer account, its private credentials, and a recorded cloud
  walkthrough are still required. Never put reviewer passwords in the public ZIP.

## Deployed endpoints

- Public MCP: https://ai-fighter-validator.onrender.com/mcp
- Original connection: https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp
- Google consent UI: https://oddbout.com/connect.html
- EN/KR product, support, privacy and terms pages: https://oddbout.com/cloud-plugin/
- Domain proof: https://ai-fighter-validator.onrender.com/.well-known/openai-apps-challenge

The gateway forwards only the fixed Supabase MCP endpoint with bounded request
bodies and protocol headers. It does not receive an administrative database key
or forward cookies, wake headers, user-supplied destinations or redirects.
Supabase still checks signatures, issuer, the dedicated MCP role/marker, owner,
OAuth client, live session, consent and revocation. The two HTTPS entry points
are explicitly accepted audiences of this one service. Ordinary database and
storage access remain unavailable to these OAuth tokens.

The user explicitly approved the additional Render entry point and token
handling after automatic approval review initially rejected that change.
The existing free Render instance can take 50 seconds or more to start after
inactivity; do not claim instant initial connections. No paid plan was selected.

The MCP Edge Function is ACTIVE version 5. The public origin hook migration was
applied. Live checks confirmed the exact deployment commit, verification file,
resource metadata, all nine tools, and HTTP 401 for an unauthenticated private
tool call. The final publication tool is annotated as destructive because its
immutable package becomes public. Twelve targeted gateway, MCP/authentication
and worker tests passed. No new fighter was generated or published for review.

## Connection screen

Uses the existing ODDBOUT logo and self-hosted Pretendard fonts. EN/KR covers
headings, actions, consent, errors, accessibility labels and support links.
Language changes preserve the current authorization ID. The initial choice
uses URL, session preference, then browser language. Narrow app panels use a
single column. Content hashes version the CSS and JS to avoid stale caches.

Both desktop and 390px layouts were inspected, including the actual app panel.
The public HTML, CSS, JavaScript and all eight information pages were compared
with the generated files. Existing game-site deployments were fast-forwarded
and preserved before adding these files.

## Resume submission

1. Obtain the pending explicit portal-access confirmation. Browser automatic
   approval review rejected observation of the signed-in OpenAI Platform origin,
   even though the user requested public submission. Do not bypass this gate.
2. Upload the prepared 1.0.1 ZIP to the existing ODDBOUT draft, not a new plugin.
3. Connect the public MCP URL and verify its domain using the exact challenge
   currently shown by the portal. If that token changed, update the public proof.
4. Use a dedicated review account and sample data, not the owner's Google
   account. Run the documented review cases and record actual results.
5. Add a real walkthrough URL and private reviewer credentials in Review details.
6. Resolve blocking metadata/tool findings, inspect any binding attestations,
   and submit. Record the actual queued review status and submission identifier.

The old local-MCP support case is not a prerequisite for these steps. A draft,
successful deployment or domain proof response is not a completed submission.
