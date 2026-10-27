# Official Library file input: server identity proof

Verified on 2026-10-26 at 09:24 UTC (18:24 KST).

An existing Library PNG was selected through the official Library picker and
passed to the authenticated ODDBOUT `verify_creator_file_input` tool through
`openai/fileParams`. The server downloaded the file and independently measured
its bytes and SHA-256. Both matched the previously measured original:

| Observation | Result |
| --- | --- |
| Tool result | `ok=true`, `stage=file-input-verified` |
| Actual byte count | 1,596,801 |
| Actual SHA-256 | `4e5e820aa120a4efd0d87802b0a014bb479d750da0998c7375198688de018979` |
| PNG header dimensions | 1254 x 1254 |
| Expected size and hash match | Both true |
| Persisted / registered / Library-to-VM verified | All false |

The authenticated tool receipt, original file measurement and independently
retrieved attachment agreed. HTTP 200 alone was not used as evidence of file
identity. The deployed `ai-fighter-mcp` function was version 17 at verification.
This proves this particular Library-to-server input, not recovery of the stored
VM's Library helper or support for every file and region.

## Implementation and boundaries

The tool declares the official `openai/fileParams: ["file"]` metadata and the
host's `download_url` / `file_id` schema. It requires an active ODDBOUT OAuth
session, accepts at most 4 MiB into memory, and reports actual size and SHA-256.
The PNG signature and IHDR check is explicitly a header check, not full image
decoding or visual validation. No file is persisted, generated or registered.

Two exact Azure origins were observed in native file-input calls:

- `oaisdmntprnznorth.blob.core.windows.net`
- `oaisdmntprwestus.blob.core.windows.net`

The diagnostic tool alone allows those origins in addition to the existing
host-file origins. Other Azure tenants, non-HTTPS URLs, user information,
non-default ports, fragments and redirects remain rejected. Registration tool
origin rules and VM network settings are unchanged. Rejected-origin diagnostics
include only origin properties, never signed paths, query strings or credentials.
A completed diagnostic can return `ok=false` with `isError=false` so the host can
retain its structured findings; callers must inspect `ok` and the match flags.
Authentication and unexpected execution failures remain errors.

## Findings from the live comparison

Re-uploading the original as a browser image attachment produced a PNG with
2,209,116 bytes and a different SHA-256. Full local RGBA decoding showed identical
pixels, but different encoded bytes. The exact conversion stage was not isolated.
For an original-byte check, do not assume image re-upload preserves PNG encoding.
Direct selection of the existing Library item preserved the original in this run.

The existing conversation retained its previous tool catalog after an app refresh.
A user-authorized fresh verification conversation exposed the new tool. Two
intermediate calls whose return values were not printed remain unknown; only the
final explicit structured receipt establishes success.

The stored VM's earlier `tools/list ... network` failure remains unresolved.
Private server storage and a subsequent authenticated VM download are separate,
unimplemented steps and must be verified independently.

## Local regression checks

```sh
node --test test/file-input-probe.test.mjs test/cloud-mcp.test.mjs test/cloud-gateway.test.mjs
```

These tests cover the wire schema, authentication, actual-byte hashing, mismatch
receipts, bounded responses, origin restrictions and secret-safe diagnostics, plus
existing cloud MCP and gateway behavior. They use synthetic identities and a tiny
PNG fixture; the live original and private diagnostic records are not committed.
