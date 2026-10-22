# AI Fighter Creator distribution

The local checkout plugin is installed separately from a public directory listing. Version 0.2.0 adds
a self-contained **Windows x64 Node MCP bundle**. Node.js 22.12+ must be on PATH. Python 3.11+ and
the pinned sprite-gen environment are installed explicitly on the creator's computer before generation.
Generation provider accounts and any usage charges belong to that creator.

## Build and install the portable package

```sh
npm run plugin:bundle -- output/ai-fighter-portable
codex plugin marketplace add /absolute/path/to/output/ai-fighter-portable
codex plugin add ai-fighter-creator@ai-fighter-local
```

This uses the same marketplace identity as the checkout-linked development plugin, so changing
the marketplace source upgrades the existing plugin rather than installing a second active namespace.
When `ai-fighter-local` is already configured from a different build directory, remove its source with
`codex plugin marketplace remove ai-fighter-local` before adding the new directory, then run
`codex plugin add ai-fighter-creator@ai-fighter-local` to refresh the installed version.

The builder uses the pinned clean sprite-gen tree, retains its Apache-2.0 LICENSE and NOTICE,
and installs Node production dependencies from the lockfile with lifecycle scripts disabled.
It never copies the source checkout's output, venv, user home, credentials or npm configuration.
The ZIP contains `plugin.json` at its root, one stdio server in `mcp.json`, the creation skill, an icon,
the launcher, runtime source and Node dependencies. `${PLUGIN_ROOT}` resolves installation paths;
no maintainer path is embedded in MCP configuration. Existing output is never overwritten.

On first use the launcher verifies the bundled runtime bytes and copies them into
`~/.ai-fighter/creator/runtimes/<bundle-hash>/`. This writable copy holds its own sprite-gen venv.
Projects live in `~/.ai-fighter/creator/workspace/`; an upgrade keeps that workspace. Existing account
sessions remain at the login helper's usual `~/.ai-fighter/client.json`. The launcher performs no
network install, login, generation or upload. Host execution permissions still apply.

For testing, set `AI_FIGHTER_CREATOR_HOME` to a new absolute directory. `AI_FIGHTER_ROOT` can name
an explicit existing project workspace. `node launcher.mjs --status` initializes the bundled runtime
and reports its paths without starting MCP. The runtime is trusted local software, not an OS sandbox;
do not run unreviewed commands or recipes from someone else's project.

The build report and checksum describe only that build. The ZIP must be rebuilt after source changes.
Other OS/CPU combinations are not yet validated; do not advertise them as supported.

## Listing links in 0.2.1

Version 0.2.1 sets the following published URLs in `extensions.com.openai.interface`:

| Field | Public URL |
| --- | --- |
| `websiteURL` | https://oddbout.com/ai-fighter-creator/index.html |
| `supportURL` | https://oddbout.com/ai-fighter-creator/support.html |
| `privacyPolicyURL` | https://oddbout.com/ai-fighter-creator/privacy.html |
| `termsOfServiceURL` | https://oddbout.com/ai-fighter-creator/terms.html |

The English policies link to Korean translations. The publisher is Lucas Foundation and the policy
effective date is 2026-10-22. Both the checkout-linked builder and portable builder copy this manifest;
the portable build report includes the four URLs. Build a new 0.2.1 package instead of editing an
installed 0.2.0 cache. Upload the new ZIP after organization allowlisting; changing local metadata
does not create or update a Platform directory draft. Review footage remains outstanding.

## Public directory status and prerequisites

The ZIP is a distribution candidate, **not an approved public app**. Installation from a local
marketplace does not imply publication. Official local MCP submissions currently require OpenAI
partner eligibility and organization allowlisting. The submission flow then requires a verified
publisher identity. See the [desktop-only guide](https://developers.openai.com/plugins/deploy/desktop-only)
and [submission requirements](https://developers.openai.com/plugins/deploy/submission).

Before public submission:

- Obtain OpenAI's confirmation that the submitting organization is allowlisted.
- Complete the developer/organization identity verification in the Platform portal. Use that identity
  for `extensions.com.openai.interface.developerName`; do not invent a verified publisher.
- Keep the published privacy and terms pages and the four listing URLs above current. Account data,
  local project files, provider uploads, registration storage and retention must be described accurately.
  A source-code license alone is not the service's terms or privacy policy.
- Run five positive and three negative reviewer cases against the actual release. Provide reviewer
  access separately in the secure portal if required, plus an accessible video of the real workflows.
  Automated tests do not prove successful media generation or registration.
- Upload the ZIP with its local MCP configuration after allowlisting, follow portal findings, and submit
  for review. Publish only after approval. Do not upload account credentials, local work output or
  support correspondence as part of the public package.

The repository intentionally contains no organization ID, support conversation, reviewer credentials,
identity documents or invented demo URL in its distributable metadata. Local request records belong
under ignored `output/`. See `PLUGIN-REVIEW-CASES.md` for the reviewer scenarios to execute.
