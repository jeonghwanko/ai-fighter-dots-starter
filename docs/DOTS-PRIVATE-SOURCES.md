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
   emit its image content when supported. If that output is not visible to the user, open the existing
   private Page through the host's supported Page panel or browser viewer. Observe the actual preview
   and ask for review only after the user can see it. A screenshot can show a still preview, but cannot
   prove animation playback. Record native inline display, Page display and user confirmation separately.
   Reuse the saved file and Page; do not regenerate or invent a different file ID to repair display.
5. For appearance review, upload the unchanged full-body image and an actual crop of that same version.
   A TEST fixture may establish transport only. It never establishes generation or character quality.

6. For a single-play attack/reaction preview, preserve the game strip and once-return metadata. If the
   host clears a transparent GIF after playback ends, inspect every decoded frame, last-frame alpha,
   loop and disposal before changing anything. The official compose-gif exporter can create a separate
   repeating review GIF with loop-count 0 from the same final frames. Preserve frame order, RGBA, size,
   durations and alpha threshold; verify the export against the original and label it review-only.
   This repaired the observed attack Page previews without another provider call. It is not permission
   to change game playback or silently re-time frames.

The PNG route was exercised on the selected saved VM: 3,589 unchanged bytes, owner-only Page, native
file reference, full Page image visibly loaded in the browser, and image content recovered in the
parent conversation. The requested character's native reference emission then failed to display for the
user, while opening the same private Page preview succeeded. Later, fightIdle/walk/run GIFs were stored
and the user confirmed actual playback and selected the poses. These observations establish those
specific routes and outputs, not every format, user or future group. A queued panel is not display
evidence. Verify each group's actual playback before review; a static screenshot does not replace it.
Missing Pages capability is a delivery blocker, not permission for public storage, credential extraction
or repeated generation.

During generation, report observed job stages and completed outputs, keeping the original job/request
identity across interruptions. Show an already selected reference only with that label; do not imply it
is an intermediate generated result. If the provider supplies no numeric progress, leave the percentage
unknown and use stage text. Native image-generation progress cards are host UI, not a capability this
repository can assume for a Grok CLI job.
