# Security boundary

This is a local authoring starter, not a public upload service or approval authority.

- STDIO only; no listening TCP port, external fetch, cloud write, authentication secret, or registration tool.
- File tools require an explicit trusted `AI_FIGHTER_ROOT`. Inputs are relative manifest paths.
- Keep untrusted processes from modifying that directory during validation. Path checks are not an OS filesystem sandbox.
- Native image decoding runs serially in a child process with a deadline. V8's heap limit does not constrain all native memory.
- For remote uploads, add immutable staging, OS resource isolation, authentication, authorization, quotas and authoritative revalidation.
- Profile strings and error values are untrusted data. Never execute them or insert them as raw HTML.
- A passing local validation does not establish ownership, visual quality, fair gameplay, or registration.
- No credentials belong in this repository. Report vulnerabilities through the repository's private security reporting when available; otherwise open an issue without secrets or private file contents.

See [the adversarial review](docs/ADVERSARIAL-REVIEW.md) for reproduced defects and remaining release blockers.
