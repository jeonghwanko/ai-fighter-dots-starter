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


## VM previews through a private Page

When local view_image cannot render in the parent conversation, use the host's supported Pages file
bridge if available. This does not expose originals through a public bucket or signed URL in chat.

1. Reuse the user's existing authorized private review Page, or create one private personal Page for
   this creation. Read its content/guidance and verify owner-only access with get_page_sharing. Do not
   change sharing or infer that a Page is private merely from its title.
2. In the VM, call Pages write_page_reference with the actual local PNG/JPEG/GIF/WebP path and Page ID.
   The host file-input bridge uploads it. Verify file_access_confirmed, byte_size and sha256 against
   the local original; retain the returned reference and receipt. No synthetic file IDs or URLs.
3. Insert only the returned native image Markdown using the Page's fresh edit guards, then read it
   back. An uncertain upload must be reconciled using its receipt/existing reference before retrying.
4. Use the returned Page/reference with the host's read_page_reference in the target conversation and
   emit its image content. Inspect the actual target UI. Page rendering, a returned image block and
   current-conversation rendering are separate observations; record each honestly.
5. For appearance review, upload the unchanged full-body image and an actual crop of that same version.
   A TEST fixture may establish transport only. It never establishes generation or character quality.

The PNG route was exercised on the selected saved VM: 3,589 unchanged bytes, owner-only Page, native
file reference, full Page image visibly loaded in the browser, and image content recovered in the
parent conversation. A queued panel is not display evidence. Animation formats/playback still need
verification when that review group is reached. Missing Pages capability is a delivery blocker, not
permission for public storage, credential extraction or repeated generation.
