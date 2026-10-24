# ODDBOUT cloud plugin review

Status on 2026-10-24: **submitted; portal shows 1.0.2 · In review**.
Publication is still **Not published**; submission is not approval.
This remote MCP submission is independent of the local MCP eligibility case.

## Final draft and public addresses

- Portal: https://platform.openai.com/plugins/manage/plugin_asdk_app_6adc695de1bc8191a604b42bbaa178af
- Version: `appsub_6adc695de1ec8191a9e9734d647cef44`, package `oddbout-dots` 1.0.2.
- Source: `plugins/oddbout-cloud/`. Publisher: verified individual **정환 고**.
- Public MCP: https://mcp.oddbout.com/mcp
- Google/email consent UI: https://oddbout.com/connect.html
- EN/KR product, support, privacy and terms: https://oddbout.com/cloud-plugin/
- Domain proof: https://mcp.oddbout.com/.well-known/openai-apps-challenge

The portal locks an uploaded package's MCP URL. Earlier Supabase and Render URL
drafts remain unsubmitted; the own-domain draft above is the final target.
Do not submit the earlier drafts or overwrite their hostname's challenge token.

Spaceship DNS has `mcp CNAME ai-fighter-validator.onrender.com` (TTL 30 minutes).
Render verified the custom domain and issued its TLS certificate. Existing root
GitHub Pages A records and the www CNAME are unchanged. The original Render URL
remains a compatibility endpoint; public plugin metadata uses the branded URL.

## Authentication and hosting

The gateway forwards only the fixed Supabase MCP endpoint with bounded request
bodies and protocol headers. It receives no administrative database key and
forwards no cookies, wake headers, arbitrary destinations or redirects. Resource
metadata selects one of two fixed public origins from the incoming hostname.
Supabase still checks signatures, issuer, dedicated MCP role/marker, owner,
OAuth client, live session, consent and revocation. The original Supabase URL,
legacy Render URL and branded URL are explicitly accepted audiences of one
service; ordinary database/storage access remains unavailable to OAuth tokens.

Edge Function version 6 and the branded-audience migration are deployed.
Render deployment `dep-dbe6lqjncjis73d6mmkg` serves gateway commit
`4d745e42df6663f7e7384e6dac36d610ae029358`. Live checks verified the exact commit,
branded resource metadata, hostname-specific challenge, nine tools and a branded
HTTP 401 authentication challenge. The portal verified the domain and completed
OAuth with the dedicated reviewer. Its MCP scan reported no findings.
The free Render instance can
take 50 seconds or more to start after inactivity. No paid plan was selected.

A dedicated ordinary reviewer account was created with explicit user approval.
Password login and the final own-domain draft's OAuth consent completed in the
real browser. Credentials are stored outside the repository in a restricted
local file and may be sent only to OpenAI's private Review details. Never put
reviewer passwords in source, ZIPs, screenshots, logs or public walkthroughs.

## Connection screen

Uses the real ODDBOUT logo and self-hosted Pretendard fonts. EN/KR covers
headings, actions, consent, errors, accessibility labels and support links.
Language changes preserve the authorization ID. URL preference, session
preference and browser language determine the initial locale. Narrow app panels
use one column. Content hashes version CSS/JS. The primary Google button and
expandable email login both use normal Supabase authentication; no bypass exists.

Desktop and 390px layouts were inspected. The real reviewer email login and
consent screen were verified. Existing game-site updates were fast-forwarded
and preserved before publishing the connection and policy pages.

## Submitted evidence and outcome

- Five live non-publishing MCP cases passed on the dedicated review account:
  profile, registration readiness, overview contract, empty owned fighter list,
  and accurate not-found handling for a nonexistent submission.
- The checks used normal password authentication, a separate OAuth client,
  PKCE S256 and consent. Its temporary grant was revoked after testing; the
  portal's ChatGPT connection was preserved.
- Twelve targeted gateway, MCP/authentication and worker tests passed.
- Sanitized responses: https://oddbout.com/cloud-plugin/review-20261024/evidence.json
- Walkthrough: https://oddbout.com/cloud-plugin/review-20261024/walkthrough.mp4
  (87-second video assembled from actual authentication and response screenshots;
  not a recording of a ChatGPT conversation). Live bytes matched local files.
- Final ZIP SHA-256: `1b5f1c713a60670434f8d773a019041e66865647faca0113821aaad95292be82`.
- Dedicated credentials and sign-in instructions were saved only in the portal's
  private reviewer fields. The package includes five positive and three negative
  scenarios. Negative server boundary checks do not certify model behavior.
- The user explicitly confirmed all six legal/policy attestations at the final
  submission step. The Submit action completed, and the final plugin details
  show **MCP configuration Configured**, **1.0.2 · In review** and
  **Publication Not published**. The portal list labels its associated initial
  MCP app version 1.0.0; the submitted package version is 1.0.2.
- A non-blocking category finding remained: the scanner could not confirm
  Productivity. There were no blocking findings at submission.

Await the external review decision. Do not submit the earlier drafts or claim
that ordinary users can install this listing from the directory before approval.

At initial submission no fighter was generated or published. The five recorded
account checks and initial video did not exercise successful registration; that
scope was disclosed in the private review instructions and video.

## Additional native Dots verification

After submission, the user explicitly authorized a real registration test on the
dedicated reviewer. Dots transferred an existing approved package (11 WebP files,
5,537,184 bytes), with test-only profile metadata, using native MCP file inputs.
Submission `131d7814-2c24-4a82-9707-1ebff7978f67` became registered fighter
`1c6160e0-a138-4e25-8b95-db023b8cc408`, named `ODDBOUT Review Test`.
The public MCP gateway independently returned the same immutable manifest hash
and `runtimeApproved: true`; seven read-only checks passed and their temporary
OAuth grant was revoked. The review account now contains that one test fighter.
No new artwork was generated. See [the registration record](CLOUD-MCP.md#실제-파일-등록-검증--2026-10-24).

MCP function v7 clarifies intended-account checks, absolute host file inputs,
original-byte recovery from Library/Page files, and the distinction between VM
network policy and native connector access. Authentication and publication
validation are unchanged. The submitted 1.0.2 listing remains under external review.
