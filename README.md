# AI Fighter × Dot starter

**English** | [한국어](README.ko.md)

Create your own fighter with Dot, then register it and play in AI Fighter. Start with a short description, reference images, or both. Dot runs the bundled **sprite-gen** locally, shows you the artwork and animations, applies your feedback, and builds and submits the fighter package when you request registration.

This kit is MIT-licensed; the bundled sprite-gen submodule is Apache-2.0. Generation uses **your own accounts and subscriptions**. You do not need an AI Fighter account to begin creating locally. Google sign-in is required to upload and register; no invitation or manual approval is required.

## 1. Start a local chat

For an installable local Codex plugin, run `npm run plugin:build`. **AI Fighter Creator** bundles the
creation skill and MCP connection, with preserved versions, group feedback and resumable job records.
See [local plugin setup](docs/LOCAL-PLUGIN.md). Each user builds the local connection on their own computer.
For a standalone Windows desktop ZIP and public submission requirements, see [plugin distribution](docs/PLUGIN-DISTRIBUTION.md).

Send the [start link with the current game specification](https://github.com/jeonghwanko/ai-fighter-dots-starter/blob/codex/game-context/START-HERE.md) to a new Dot chat. It starts by asking what character you want to make. You can also give this repository URL to Dot, Codex, or Claude in an environment that can run local commands and access files.

For example:

> Create a cat boxer in blue armor for AI Fighter using this repository.
> Show me one concept image first and revise it with my feedback.
> Once I choose the appearance, show me locomotion, attacks, and defense/reactions as separate groups.
> After I select the final result, validate the package, register it with my account, and confirm that it is available in the game.

The agent handles setup, generation, extraction, measurement, packaging, and validation. You decide how the character looks and moves. The [dialogue-only link](https://github.com/jeonghwanko/ai-fighter-dots-starter/blob/codex/game-context/DIALOGUE-ONLY.md) is available separately for checking the conversation without generating assets or registering a fighter.

## 2. Prepare the local tools

Requirements: Git, Node.js **22.12+**, Python **3.11+**, and a host that can run local commands. The host can be a bot service's per-user workspace VM or your own PC; see the [execution host guidelines](docs/EXECUTION-HOST.md) for accounts, isolation, persistence and security. The agent can perform these setup steps for you:

```sh
git clone --branch codex/creator-hosting --single-branch https://github.com/jeonghwanko/ai-fighter-dots-starter.git
cd ai-fighter-dots-starter
npm ci --ignore-scripts
npm run sprite:setup
npm run sprite:status
npm run sprite -- workflow --kind sprite
```

Use `codex/creator-hosting`, which contains the public service configuration in `deploy/creator-site.json`. `sprite:setup` fetches the pinned sprite-gen revision (about 100 MB) and installs it in this checkout's dedicated virtual environment. Use Git clone: a GitHub ZIP does not include the submodule contents. An existing installation can be reused after checking its version and preserving local changes.

The agent reads `AGENTS.md`, the [creation workflow](docs/DOT-CREATION.md), the [authoring guide](docs/AUTHORING.md), and `vendor/sprite-gen/SKILL.md`. It checks your current generation access and asks only for missing choices. `sprite:status` alone does not confirm login or subscription access.

The kit applies a [hash-bound GPT motion patch](patches/README.md) to its pinned sprite-gen source. It retains source flight height in painted-row extraction and passes reviewed motion references to GPT. Unknown local edits are preserved and block patching. A completed generation still requires the [gait review](docs/GAIT-REVIEW.md).

The default recommendation is **GPT artwork + Grok motion** when both are available, all Grok when only Grok is available, or all GPT when only GPT is available. Your explicit choice takes priority. Image and video access are checked separately; switching providers or using a paid API requires your choice.

## 3. Connect the AI Fighter tools

For desktop Codex, print the MCP installation command:

```sh
node scripts/print-install.mjs
```

Run the printed `codex mcp add ai-fighter --env ... -- ...` command. It includes the absolute Node and server paths and the trusted workspace, `AI_FIGHTER_ROOT`. Confirm the connection with `codex mcp list`, then open a new local chat. Restart the app if the tools do not appear. If you move the checkout, print and run the command again from its new location. Other local hosts must connect `mcp/stdio.mjs` as a stdio MCP server with the same workspace setting.

The agent reads `get_fighter_spec` sections `context`, `overview`, `creation`, `guide`, and the required `schema`. The game owns the current motions, frame requirements, controls, and timing. Refresh `context` at each review group and before packaging; the agent keeps your selections tied to the relevant versions. See [game-provided creation context](docs/GAME-CREATION-CONTEXT.md).

Local creation can begin before MCP is connected. A browser-only chat that cannot execute local processes needs a local host to perform generation and packaging.

## 4. Create and review the fighter

The agent completes each agreed group, shows its actual previews together, and waits for your feedback before the next group. Accepting a group advances the work. A revision changes the affected assets while preserving your other selections. You can explicitly delegate later groups; each motion does not need a separate permission question.

| Group | What you see and choose |
| --- | --- |
| Appearance | One full-body concept, the `idle` reference pose, and a face close-up from the same artwork |
| Locomotion | `fightIdle`, 16-frame `walk`, and 12-frame `run`, played at a consistent scale |
| Attacks | `combo`, `slam`, and `dash`, including preparation, contact, and recovery |
| Defense and reactions | `block`, `hit`, `groggy`, `fall`, and get-up poses |
| Final review | All 11 required motions played from the final package, plus the name, description, and portrait |

The agent checks character identity, actual movement, alternating feet, ground contact, and attack timing. Walk/run reviews use the final pixels and playback durations. Passing JSON or image decoding checks alone does not establish animation quality. See [gait review](docs/GAIT-REVIEW.md) and the [creation UX rules](docs/CREATION-UX.md).

The agent prepares the game-pack request and packaging plan, then runs:

```sh
npm run sprite -- game-pack --request game.json --out-dir pack
npm run fighter:pack -- plan.json
npm run validate -- output/my-fighter/fighter.json
```

Request, plan, and output paths belong to the current fighter's working folder. The tools measure dimensions, origins, ground contacts, and hashes from the actual files. The result contains `fighter.json` and static WebP sheets under `output/my-fighter/`. The agent corrects validation errors and shows the final package before registration. See [packaging instructions](docs/DOT-CREATION.md#패키지-만들기-game-pack--fighterpack).

## 5. Sign in and register

The creator flow is **Connect ODDBOUT → sign in with Google → confirm the public pairing code and approve**.
The kit reports registration API/account access, generation access and parent-conversation delivery separately.
VM host permissions and Republish belong to the initial environment preparer; creators reuse the prepared workspace.
The kit does not install a Dots-native button or change VM network policy. Hosts can render the connection action
as a button, or use a choice and official link. See [connection readiness and recovery](docs/CONNECTION-READINESS.md).

When you request registration, the agent reads `deploy/creator-site.json` and starts Google sign-in using the **origin of `apiBase`** as the project URL and `publishableKey` as the public key. You use the existing service; you do not need to create a Supabase project or obtain a service key. The equivalent command, with those public values substituted, is:

```sh
npm run login -- --url https://YOUR_PROJECT_REF.supabase.co --key YOUR_PROJECT_PUBLISHABLE_KEY
```

If the agent works in a bot service's VM, your browser is on a different machine from its `127.0.0.1` callback. Use an officially supported secure handoff or device connection; if none is available, the agent reports that sign-in is blocked. Callback addresses can contain login codes or tokens: do not paste them into the creation chat. The CLI's existing `--paste` / `--finish` options do not themselves provide a secure transport, even with PKCE and expiry. The secure route is the device connection. When the deployed server advertises it, the agent runs `npm run login -- --device`, which prints a link to the creator homepage with a public pairing code. You open the link, sign in with Google, check that the code matches, and approve. The agent then runs `npm run login -- --device-wait`, and no login code or token passes through the chat. Until the server advertises it, the agent reports sign-in as blocked. See the [execution host instructions](docs/EXECUTION-HOST.md#7-등록).

Choose the same Google account you will use on the creator homepage. Login saves your session to `~/.ai-fighter/client.json`, which the running MCP loads on the next call; a login-only app restart is unnecessary. `AI_FIGHTER_CLIENT_CONFIG` can select another session-file location. Keep session tokens private.

The agent then completes these steps:

1. Run `validate_fighter_manifest` and `validate_fighter_package` on the selected final files and fix any errors.
2. Call `submit_fighter_package` with the relative manifest path and a UUID `idempotencyKey`. Reuse that key for retries of the identical package; use a new key if the package bytes change.
3. Read `get_fighter_submission` until it returns a final result. An uploaded or queued package is still awaiting automatic server file validation.
4. Confirm `stage: "registered"`, a real `fighterId`, and `runtimeApproved: true` before reporting that the fighter is registered and available. Use `get_registered_fighter` to read the saved profile.

The server checks the stored files again and makes successful registrations available automatically. A sleeping validation worker can delay processing; this is an automatic queue, not a manual approval queue. A rejected package includes validation errors to correct before resubmission. An unknown upload or generation outcome must be checked before retrying to avoid duplicate work.

Current service limits are one fighter per account, up to five submissions, 10 MB per package, and 100 MB of total reserved storage. Inappropriate fighters can be removed after registration. See the [current access and removal policy](docs/OPEN-REGISTRATION.md).

## 6. Open your fighter and play

Open the [creator homepage](https://jeonghwanko.github.io/ai-fighter-dots-starter/creator.html?lang=en), sign in with the same Google account, and check your registered fighter and animations. You can also ask Dot:

> Open the AI Fighter homepage with the account that owns my registered fighter.

`open_creator_homepage` returns a one-use sign-in link that works in a browser on any device and expires after ten minutes. Open it yourself and keep it private. Ask for a new link if it has expired or has already been used.

The game supports direct control and common-AI control. Registered fighters use the same game rules; fighter JSON contains no executable code. The server computes matches and stores results and rankings so they remain available across browsers.

## If something fails

**Creation, sign-in, upload, registration, and gameplay are supported workflows. A failure in the documented flow with valid inputs is a bug to reproduce and fix.** Record the failing step and error; do not dismiss it as an experiment or mark an incomplete result as complete.

- If the artwork or motion is wrong, revise the affected version and repeat its review.
- If validation rejects a file, correct the reported path or field and validate again. Keep the quality checks in place.
- If generation or submission times out, inspect its existing request, status, and files before starting another attempt.
- If a tool, login, server, or game step fails unexpectedly, report it in the [repository issue tracker](https://github.com/jeonghwanko/ai-fighter-dots-starter/issues) with reproduction steps, expected and actual behavior, the error code, and the relevant tool version or commit. Exclude credentials and private files.

## MCP tool reference

| Tool | Input | Result |
| --- | --- | --- |
| `get_fighter_spec` | `section`: context/overview/creation/guide/schema/example; optional `group` or `motion` | Current game context, creation workflow, contract, and examples |
| `review_creation_progress` | `stateJson` | Remaining group blockers and whether the group can advance |
| `validate_fighter_manifest` | Raw `manifestJson` string | Structure, references, and budget checks |
| `validate_fighter_package` | Relative `manifestPath` | Actual files, hashes, and full WebP decoding checks |
| `submit_fighter_package` | Relative `manifestPath`, UUID `idempotencyKey` | Authenticated upload and queued server validation |
| `get_fighter_submission` | `submissionId` | Validation, registration, or rejection status |
| `get_registered_fighter` | `fighterId` | Persisted fighter profile |
| `open_creator_homepage` | None | One-use sign-in link for the current account |

File tools require `AI_FIGHTER_ROOT`. Remote tools require a valid user session. Remove the Codex connection with `codex mcp remove ai-fighter`.

This MCP supplies the contract, validation, and registration tools. Local generation uses the bundled sprite-gen with your account; supported appearance previews can use the host's direct image tool after the [delivery preflight](docs/DELIVERY.md). The conversation model, CLI worker model and image backend are separate; login or a requested model name does not verify generation support. The stdio setup above runs on a local host. A web-only ChatGPT connection requires a separately hosted HTTPS MCP endpoint with per-user authentication.

## Development and reference

Local contract and MCP checks:

```sh
npm run spec:check
npm test
npm run validate -- examples/sparring-bot/fighter.json
npm run mcp:smoke
```

`examples/sparring-bot`, `npm run example`, and Challenger Bot are geometric fixtures for format and service checks. They are not generated character deliverables. A successful smoke check still reports `pending: ["runtime-preview", "visual-review", "server-registration"]`; it does not create or register your fighter.

The game source is maintained separately. Running matches on a self-hosted service requires the production game engine bundle; this kit's empty engine adapter returns HTTP 503 for match creation. See the hosting instructions for deployment requirements.

The vendored v1 contract lives in `contracts/ai-fighter/v1/contract-source.mjs`. [SOURCE.json](contracts/ai-fighter/SOURCE.json) pins the copied validator files by hash. Compare an updated game contract with `npm run contract:vendored -- --compare <game-kaito_web-directory>`; incompatible field or limit changes require a new specification version.

Further documentation (some guides are in Korean):

- [Creation workflow](docs/DOT-CREATION.md)
- [Authoring and package contract](docs/AUTHORING.md)
- [Creation UX and review rules](docs/CREATION-UX.md)
- [Game-provided creation context](docs/GAME-CREATION-CONTEXT.md)
- [Gait planning and review](docs/GAIT-REVIEW.md)
- [Current access and removal policy](docs/OPEN-REGISTRATION.md)
- [Hosting and deployment](docs/CREATOR-HOSTING.md)
- [Security boundary](SECURITY.md)
