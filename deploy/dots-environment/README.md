# Saved Dots Linux environment

Use a **fresh Debian 12 / Ubuntu 24.04 or newer environment**, one user per running VM. In the environment's
Install script, clone this repository at the reviewed front-door commit and run:

```sh
bash deploy/dots-environment/install.sh
```

The script installs Node **22.22.2** with pinned official SHA-256, Python **3.11+**, venv, Git,
ffmpeg/ffprobe, WebP `img2webp -exact`, Grok CLI **1.0.70** from its npm lock, and the pinned creation kit.
OS packages follow the chosen base image's security repository; the installed versions are recorded by
`dots:start`. This is an environment-preparer operation, before any user login or character work.
Grok's npm lifecycle scripts are disabled: its official launcher supports in-package binary extraction
when the home directory is unwritable. Do not change HOME/GROK_HOME to route around authentication or
host restrictions. Confirm the actual launched CLI version; no login or agent prompt is used by installation.
The script never logs in or generates. Do not run it over a user's active environment.

Set the Start skill to [DOTS-START.md](../../docs/DOTS-START.md), and save the repository front-door path.
Every task sources `/workspace/.oddbout-tools/env.sh` before its first command. The runtime cache
is `/workspace/.oddbout/runtimes`; the new user's persistent workspace is `/workspace/oddbout-workspace`.
The template-workspace has only setup receipts and must not be reused as a user's character workspace.
No service keys, `.grok` login, ODDBOUT sessions, private source files, or character jobs belong in the image.
The preparer's file-presence check is an aid, not a certificate that an arbitrary home directory is clean.

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
