# AI Fighter creator kit

## Dots entry point

For a repository URL or Dots creation request, read `START-HERE.md` first. Use the dependency-free
`node dots.mjs --install` front door in the prepared saved VM, and `node dots.mjs` for later requests.
`deploy/dots-release.json` selects an immutable runtime commit. Do not install the historical package
on this main checkout for Dots creation. Read the returned runtime's AGENTS.md, creation, delivery and
account instructions; it owns the supported workflow. Existing workspaces keep their bound version.
The product path is Dots orchestration with this user's Grok subscription. Preserve originals and
unknown jobs, never copy credentials or fall back to API billing, and retain group review boundaries.
The current candidate's actual VM creation acceptance remains pending; never infer success from setup.

## Historical source development

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
- Build the package with `npm run sprite -- game-pack` and then `npm run fighter:pack -- <plan.json>`
  (see `docs/DOT-CREATION.md`). It measures scale, frames, origins, contacts and hashes from the pixels.
  Do not hand-assemble sheets or type those values. The plan holds only contact steps and landmarks.
- Never invent hashes, origins, contact timing, successful generation, or registration results.
- Creation is local. Current server registration is invitation-only and needs the user's beta session.
  Submit only within the user's request, reuse the same idempotency key for retries, and distinguish
  server registration from gameplay approval. Never overwrite a registered immutable package.
- Preserve unrelated working-tree changes. Run only relevant tests. Do not run CI unless explicitly requested.

The sprite-gen gitlink pins the upstream revision. Keep its Apache-2.0 LICENSE and NOTICE.
Do not update the pin or modify vendor code as part of ordinary character creation.
