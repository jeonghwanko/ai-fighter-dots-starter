# Creator homepage

Public URL: https://jeonghwanko.github.io/ai-fighter-dots-starter/creator.html

GitHub Pages serves the `codex/creator-pages` branch of this public repository.
The branch contains the built page, assets, Pretendard fonts with their license,
and `.nojekyll`. GitHub performs only its Pages publication; source tests and
the page build run locally.

The original page source remains `kaito_web/creator.html` and `src/creator/`
in `jeonghwanko/crashbang-heroes`. Build that source into a new empty directory:

```sh
node scripts/build-creator-site.mjs /path/to/crashbang-heroes/kaito_web output/creator-site-new
```

Public build settings are in `deploy/creator-site.json`. The builder does not
read the source checkout's environment files. It includes only the publishable
Supabase key, copies the required fonts, and checks the deployed asset paths.
Publish the resulting files to the existing Pages branch after local review.

The existing Supabase project `ztfxxhtmtrvxvuxlqmgz` continues to own login,
registered fighters, storage, and API operations. Its Auth redirect allowlist
includes `https://jeonghwanko.github.io/ai-fighter-dots-starter/creator.html**`
so English and Korean Google login return URLs work. Existing redirect entries
remain available. No service key belongs in the website.

Dot's default one-use sign-in links now target the Pages URL. The former
`https://rupin.pryzm.gg/creator.html` remains an explicitly allowed legacy target.
