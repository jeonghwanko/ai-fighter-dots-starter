# Private original → saved VM

This is file delivery, independent of generation, Library persistence and conversation display.
An existing original must be recovered before retrying a generation. Do not make a screenshot or re-encode
a downloaded PNG and call it the original. Retain the original size/hash and the same idempotency key.

1. In the selected VM, run `npm run dots:source -- request <absolute-workspace>` from its pinned runtime.
   The returned public request contains `version`, `requestId`, `publicKey`. The private key stays in
   `.oddbout-private/transfers/<requestId>/key.json` with mode 0600. Never read it into chat or commit it.
2. Call connected ODDBOUT `store_creator_source` with the native host file input, the measured original
   `expectedBytes`, `expectedSha256`, and a fresh UUID `idempotencyKey`. On uncertain outcome, reuse that
   key and bytes. `get_creator_source` retrieves a known source receipt. These calls check the connected
   owner and store only in private `af-creator-sources`; they do not register or publish a fighter.
3. Call `prepare_creator_source_download(sourceId, vmRequest)` for the selected VM public request.
   Save **only its envelope object** into a JSON file inside that workspace using supported VM execution.
   Neither a signed Storage URL nor a login token is exposed to the agent. Do not substitute another VM key.
4. Run `npm run dots:source -- receive <absolute-workspace> <relative-envelope.json>`. The VM decrypts
   locally, downloads from the exact approved Storage origin without redirects, checks size and SHA-256,
   fully decodes the PNG, then atomically admits the unchanged bytes under `input/sources/<id>/<sha>.png`.
5. Retain the immutable receipt under `output/source-delivery/`. On grant expiry repeat step 3 for the
   same source and VM request; never regenerate or reupload just because a grant expired. Existing valid
   bytes are reused. Changed bytes, wrong owner, altered envelope and unsafe local paths stop the transfer.

The transfer grant lasts five minutes. Server quotas are 16 MiB per PNG, 8192 per dimension, 32 Mi pixels,
64 originals / 128 MiB per owner. Sources are retained privately for resume; no deletion or public URL
is implemented by this feature. Per-owner authorization remains mandatory even when an id is known.
The connector service role exists only on the server, never in the VM image or an output envelope.

The source receipt proves stored bytes; the VM receipt proves received and decoded bytes. Neither proves
Grok access, an actual media call, Library save, conversation display, visual acceptance or registration.
If the host cannot deliver its native file input, report that limitation. Do not bypass the host's network
policy, scrape protected sessions, extract browser credentials or regenerate an existing image.
