# AI Fighter local Codex plugin

For a standalone desktop ZIP and public submission prerequisites, see [PLUGIN-DISTRIBUTION.md](PLUGIN-DISTRIBUTION.md).

This version packages the creation skill and existing local MCP server. It adds persistent projects,
immutable version snapshots, group gates, and a managed CLI job ledger. Generation, gait inspection
and packaging continue to use the pinned sprite-gen and existing fighter tools. Credentials are not
included in the plugin; each creator uses their own accounts.

This is a desktop stdio plugin. Installing or refreshing it does not connect it to a Dots cloud chat.
The repository does not currently provide a hosted HTTPS MCP endpoint. See
[the cloud connection prerequisites](CONNECTION-READINESS.md#dots-클라우드의-mcp-연결-조건) before advising a cloud user to refresh or reconnect.

## Install on this computer

From a checkout with Node 22.12+ and `npm ci --ignore-scripts` completed:

```sh
npm run plugin:build
codex plugin marketplace add /absolute/path/printed/as/marketplace
codex plugin add ai-fighter-creator@ai-fighter-local
```

The builder prints the paths and exact marketplace arguments. On Windows, quote the printed path in
PowerShell. The last command installs the plugin; alternatively install it from **AI Fighter Local** in
the desktop Plugins Directory. Open a new local chat. Restart the desktop app if it has not appeared. Invoke
`$create-fighter`, or describe the fighter you want to make.

The generated marketplace is under `output/ai-fighter-marketplace/`. It contains portable `plugin.json`
and `mcp.json` manifests, the skill and a local marketplace catalog. MCP settings point to **this user's
existing checkout and Node executable**. Keep the checkout in place. Rebuild on each computer; do not
publish the generated directory as a standalone distributable. The builder does not change host settings.

For updates, build into a fresh directory (`npm run plugin:build -- output/ai-fighter-marketplace-v2`),
register that source and refresh/reinstall the plugin. Existing build output is never overwritten.
After changing checkout code, restart the MCP session. An existing manual AI Fighter MCP connection
may remain, but use one namespace consistently. Locks protect writers across connections.

Generation runtime setup is separate: `npm run sprite:setup` needs Python 3.11+ and installs the pinned
source in its venv. `npm run sprite:status` reports installation, not login or quota. Public plugin
publication and web-only execution are outside this local package. This version shows actual generated
media in the conversation; a dedicated comparison UI is not included.

## Project tools and evidence

A configured `AI_FIGHTER_ROOT` enables these local tools:

| Tool | Purpose |
| --- | --- |
| `list_creation_sessions` | Find projects to resume |
| `create_creation_session` | Create a project with current game context; no generation |
| `get_creation_session` | Read preserved versions, selections and remaining group blockers |
| `update_creation_session` | Record a version, review, user choice, edit or transition |
| `prepare_creation_job` | Reserve a command and return local execution arguments |
| `get_creation_job` | Read one job or list jobs; never execute or retry |
| `cancel_creation_job` | Discard an unstarted reservation |
| `resolve_creation_job` | Record evidence resolving an unknown outcome |

State lives at `output/<sessionId>-work/creation-session.json`; IDs are lowercase slugs. Each update
supplies `expectedRevision`. On conflict, read again and reconcile the actual feedback. An exclusive
file lock also serializes jobs and state across processes. Atomic replacement preserves complete JSON.

`version` copies files into `versions/<item>/<version>/` and measures their bytes and SHA-256. Editing
the source cannot destroy the selected copy. Version IDs are never reused. `select` accepts the current
version; `restore` selects a preserved earlier version at the user's request. `revision` records affected
items while preserving earlier selections. Versions record the earlier groups they depend on; changing
appearance invalidates dependent motion reviews without deleting their art.

`review` binds evidence hashes and the game context revision. Reviews are **agent-reported observations**,
not automatic visual certification or user permission. Changed saved files/evidence or a changed basis
make effective checks unverified. `advance` uses the existing game-owned group checks. `delegate` records
only the groups the user explicitly delegated. Dialogue-only sessions cannot run jobs or store production
approvals. Do not infer the user's intent from a test example.

Example `update_creation_session` arguments:

```json
{
  "sessionId": "my-fighter",
  "expectedRevision": 1,
  "change": {
    "type": "version", "item": "idle", "version": "v1",
    "files": ["output/my-fighter-work/artifacts/idle/v1/base.png"],
    "note": "Actual generated base; appearance feedback pending"
  }
}
```

`profile` records the chosen name and description. `package` needs exactly one `fighter.json`, runs
full-file validation, checks that profile, and fingerprints every manifest asset automatically.
Record `package-review` separately with actual preview feedback and evidence. A metadata edit invalidates
the package binding while preserving animation selections. Validate the new package bytes without
repeating approval of unchanged animations. Final session review never grants registration authorization.

## Managed execution

`prepare_creation_job` does not launch anything. Run its returned command, args, cwd and environment
through the host's ordinary terminal permission flow. With the default workspace:

```sh
npm run creation:run -- my-fighter <job-uuid>
```

The runner uses the explicit Node executable, existing sprite/pack scripts and `shell: false`. It is not
a background service: keep the terminal job alive and poll it normally. Upstream stdout/stderr stay in
that terminal; reports stay where the engine writes them. Declare useful report files in the plan.

| Plan field | Meaning |
| --- | --- |
| `engine` | `sprite` or `fighter-pack` |
| `args` | Exact existing CLI arguments, including the sprite command |
| `groupId` | Current review group |
| `targets` | `{item, version}` entries for affected motions in that group |
| `inputs` | Existing workspace-relative input files, including nested recipe assets |
| `outputs` | New files under `output/<sessionId>-work/artifacts/` |
| `workflowArgs` | Fresh upstream workflow preflight required for generation |

The initial sprite command allowlist is in `mcp/creation-jobs.mjs`. Other utilities remain available
through their existing CLI, without managed-job guarantees. The runner does not rewrite recipes, parse
every nested engine-specific path, or provide OS sandboxing. Use trusted local recipes and project paths;
host execution permissions still apply. Managed record paths and output flags reject traversal, symbolic
link parents, Windows device paths and alternate streams. Never put credentials in arguments or notes.

Preserve the user's exact provider/access choices and run the preflight before generation. The job UUID
is an idempotency key for **one local execution**, separate from provider IDs and server submission keys.

| Status | Meaning |
| --- | --- |
| `prepared` | Reserved, not executed; may be cancelled |
| `running` | Attempt recorded before launch; inspect before further action |
| `succeeded` | Exit 0 and declared outputs fingerprinted; visual quality unverified |
| `needs-input` | Preflight did not pass or upstream returned 75 |
| `failed` | Launch known not to start, or a non-generation utility failed |
| `unknown` | Abnormal generation exit, lost result or missing declared outputs |
| `resolved` | Evidence about an unknown outcome recorded; no rerun |
| `cancelled` | Unstarted reservation cancelled |

Identical preparation retries return the same job. Changed args under the same ID are rejected. An
attempted ID never executes again. A new ID targeting prepared/running/unknown work is blocked. A missing
runner is observed as unknown; a reused PID may conservatively keep it looking running, never success.

Inspect provider request records, original reports and outputs before resolving an unknown result,
even when no request ID exists. `recovered`, `not-started` and `duplicate-risk-accepted` require evidence.
The last requires an explicit user choice accepting possible duplicate usage; a generic continuation
does not suffice. Resolution is labeled agent-reported and never validates the evidence's meaning or
reruns a job. Inspect and record recovered output instead of generating again. To revise an unstarted
plan after a session/input change, cancel it and reserve a new ID.

If a process dies while holding `creation.lock`, reads work but mutations report
`session-busy-or-interrupted-lock`. Inspect its PID/time and existing jobs/output. Only after confirming
there is no active writer, remove that exact lock file. Never erase the session, jobs or claim markers,
or infer a failed generation from an interrupted lock.

## Verification

```sh
node --test test/creator-plugin.test.mjs test/creation-context.test.mjs test/mcp.test.mjs
```

Tests cover real MCP startup from the built plugin, preserved selections, dependency freshness, group
gates, concurrent edits, idempotent execution, unknown outcomes, preflight, path safety and existing
validation/registration behavior. Generation calls are stubbed and labeled as such. Tests do not use
generation accounts, register fighters, or run CI.

Packaging follows the official [plugin format](https://developers.openai.com/plugins/build/plugins)
and [local MCP launch format](https://developers.openai.com/plugins/deploy/desktop-only).
