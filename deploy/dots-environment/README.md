# Saved Dots Linux environment

Use a **fresh Debian 12 / Ubuntu 24.04 or newer environment**, one user per running VM. In the environment's
Install script, clone this repository at the reviewed front-door commit and run:

```sh
bash deploy/dots-environment/install.sh
```

The script installs Node **22.22.2** with pinned official SHA-256, Python **3.11+**, venv, Git,
ffmpeg/ffprobe, WebP `img2webp -exact`, Grok CLI **1.0.70** from its npm lock, and the pinned creation kit.
Existing curl, Git, xz/tar, SHA-256, Python with SSL/venv/ensurepip, and ffmpeg/ffprobe are checked and reused.
A complete managed base needs no sudo or system package changes. Only missing base tools trigger an apt
installation when root or supported noninteractive sudo is already available; otherwise preparation stops
with the exact missing list. OS packages follow the base image's security repository. `dots:start` records versions. This is an environment-preparer operation, before any user login or character work.
Grok's npm lifecycle scripts are disabled: its official launcher supports in-package binary extraction
when the home directory is unwritable. Executable extraction does not establish login storage. Do not change HOME/GROK_HOME during installation to route around authentication or
host restrictions. Confirm the actual launched CLI version; no login or agent prompt is used by installation.
The script never logs in or generates. Do not run it over a user's active environment.
Only npm/pip download caches move to the workspace tools folder; env.sh retains those paths for later
kit installation. HOME and all authentication locations remain the official defaults.

Publishing captures prepared files. Saving an Install script does not prove it ran: execute the recipe in
the environment preparer, inspect its exit code and env.sh, then publish that prepared filesystem. Verify
the same files and versions in a new task explicitly selecting this saved environment.

Set the Start skill to [DOTS-START.md](../../docs/DOTS-START.md), and save the repository front-door path.
Every task sources `/workspace/.oddbout-tools/env.sh` before its first command. The runtime cache
is `/workspace/.oddbout/runtimes`; the new user's persistent workspace is `/workspace/oddbout-workspace`.
The release-specific /workspace/.oddbout-template-workspaces/<runtime-commit> has only setup receipts
and must not be reused as a user's character workspace. Preparation retains older template bindings;
changing the release must prepare a new template rather than silently reusing an old runtime.
No service keys, `.grok` login, ODDBOUT sessions, private source files, or character jobs belong in the image.
The presence-only guard allows an empty `.grok` directory or only its official `bin` cache: launching
`grok --version` may create that cache before login. Authentication, unknown/hidden entries, symlinked
Grok/cache paths, ODDBOUT auth and injected API/service keys remain blocked. This is an aid, not a
certificate that an arbitrary home directory is clean.

Allow the actual package/login/media endpoints in the environment's network settings before publishing:

| Purpose | Hosts |
| --- | --- |
| Git source and submodule | github.com (and the host's actual Git download endpoints) |
| Node and npm | nodejs.org, registry.npmjs.org |
| Kit's pinned WebP binary fallback | storage.googleapis.com (needed only if the base image has no working WebP tools) |
| Python dependencies | pypi.org, files.pythonhosted.org; any separately declared engine dependency host |
| OS packages | The selected Debian/Ubuntu mirror and security repositories |
| Grok device login / CLI | auth.x.ai, cli-chat-proxy.grok.com |
| Engine image/video requests | api.x.ai and the exact media delivery hosts returned by the provider |
| ODDBOUT / private source delivery | oddbout.com, ztfxxhtmtrvxvuxlqmgz.supabase.co |

Do not use wildcard redirects, disable certificate verification, move credentials or tunnel around a
denied host. Library-to-connector ingress is a hosted file-input call, not a VM Library mount.
Publish/Republish affects new tasks; existing tasks retain their own environment and workspace.
The kit cannot change these host settings or publish a saved environment. A CONNECT denial identifies
the exact host for the preparer to review; HTTP reachability never proves subscription media access.

First user task: `node dots.mjs --install`. It returns one action; the agent opens the official Grok
device-login flow only if required, then reruns the same command. Thereafter `node dots.mjs` checks and
recovers the bound runtime, with no pull or upgrade of an active character. An explicit creation request
continues into the existing grouped workflow. Login and transfer receipts are not visual approval.

For a running user's read-only default home, see the explicit private GROK_HOME procedure in
[DOTS-START.md](../../docs/DOTS-START.md). This does not put authentication into the saved image.
