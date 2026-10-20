# AI Fighter creator kit

This repository lets each user create their own fighter through Dot. Read
`docs/DOT-CREATION.md`, `docs/AUTHORING.md`, and the live AI Fighter spec before creating a package.

- Use the bundled `vendor/sprite-gen/SKILL.md` and its referenced workflow. `npm run sprite:setup`
  installs this checkout's source in its own venv. `npm run sprite -- <command>` runs that environment.
- Use the current user's generation account. Never copy the maintainer's credentials, home paths,
  subscription confirmations, or saved choices to another user. Preserve upstream provider selection and billing rules.
- `examples/sparring-bot` and `npm run example` are geometric test fixtures. They do not satisfy a request
  for a generated character. Do not rename or restyle that fixture and call it sprite-gen output.
- The v1 contract requires all 11 motions, including 16 walk frames and 12 run frames. Validate actual
  motion, identity, foot alternation, and ground contact; schema/decoder success alone is not visual approval.
- Use curated sprite-gen exports and measured metadata to author AI Fighter JSON. Never invent hashes,
  origins, contact timing, successful generation, or registration results.
- Creation is local. Current server registration is invitation-only and needs the user's beta session.
  Submit only within the user's request, reuse the same idempotency key for retries, and distinguish
  server registration from gameplay approval. Never overwrite a registered immutable package.
- Preserve unrelated working-tree changes. Run only relevant tests. Do not run CI unless explicitly requested.

The sprite-gen gitlink pins the upstream revision. Keep its Apache-2.0 LICENSE and NOTICE.
Do not update the pin or modify vendor code as part of ordinary character creation.
