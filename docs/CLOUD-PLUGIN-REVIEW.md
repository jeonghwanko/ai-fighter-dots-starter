# ODDBOUT cloud plugin review

Status on 2026-10-24: **own-domain draft uploaded; not submitted for review**.
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
The gateway code must be deployed to Render before verifying the new challenge
and completing the own-domain OAuth connection. The free Render instance can
take 50 seconds or more to start after inactivity. No paid plan was selected.

A dedicated ordinary reviewer account was created with explicit user approval.
Password login and the earlier Render draft's OAuth consent completed in the
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

## Remaining submission work

1. Deploy and verify the own-domain gateway, proof, resource metadata and OAuth.
2. Run the five proposed positive and three negative review cases with the
   dedicated review account. Proposed expected outcomes are not test evidence.
3. Add an accessible real walkthrough and private credentials in Review details.
4. Resolve blocking tool/metadata findings, inspect binding attestations and
   submit. Record the actual queued review status and submission identifier.

No new fighter was generated or published for review. A draft, successful
deployment or domain proof response is not a completed public submission.
