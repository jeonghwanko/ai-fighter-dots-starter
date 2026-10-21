import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PUBLIC_CREATOR_PAGE } from '../mcp/creator-handoff.mjs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fingerprint, buildRevision, assertSameRevision, siteEntries } from './hosting-lib.mjs';

// Build the AI Fighter entries with explicit public settings, without loading source .env files.
const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) throw new Error('Usage: node scripts/build-creator-site.mjs <kaito_web> <empty-output-directory>');
const source = resolve(sourceArg), output = resolve(outputArg);
const relativeOutput = relative(source, output);
if (!relativeOutput || (!isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith('..\\') && !relativeOutput.startsWith('../'))) {
  throw new Error('Output directory must be outside the source tree');
}
const hostingRoot = fileURLToPath(new URL('../', import.meta.url));
const revision = buildRevision(source, hostingRoot);
const builtAt = new Date().toISOString();
const config = JSON.parse(await readFile(new URL('../deploy/creator-site.json', import.meta.url), 'utf8'));
if (config.siteUrl !== PUBLIC_CREATOR_PAGE) throw new Error('Hosting URL must match the MCP homepage');
if (!config.publishableKey.startsWith('sb_publishable_')) throw new Error('A public publishable key is required');
await readFile(join(source, 'creator.html'));
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('Output directory must be empty');
const { build } = await import(pathToFileURL(join(source, 'node_modules/vite/dist/node/index.js')).href);
const { creationContextPlugin } = await import(pathToFileURL(join(source, 'tools/ai-fighter/creation-context-plugin.mjs')).href);
await build({
  configFile: false, root: source, envDir: false, base: config.base,
  plugins: [creationContextPlugin(), {
    name: 'standalone-creator-origin',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/platform/fighterCreator.ts')) return;
      const old = 'export const PUBLIC_CREATOR_ORIGIN = "https://rupin.pryzm.gg";';
      if (!code.includes(old)) throw new Error('Creator origin source changed; review the standalone build');
      return code.replace(old, `export const PUBLIC_CREATOR_ORIGIN = ${JSON.stringify(new URL(config.siteUrl).origin)};`);
    },
  }],
  define: {
    'import.meta.env.VITE_AI_FIGHTER_API_BASE': JSON.stringify(config.apiBase),
    'import.meta.env.VITE_AI_FIGHTER_PUBLISHABLE_KEY': JSON.stringify(config.publishableKey),
    'import.meta.env.VITE_AI_FIGHTER_GAME_URL': JSON.stringify(config.gameUrl),
  },
  build: {
    target: 'es2022', manifest: true, outDir: output, emptyOutDir: false, copyPublicDir: false,
    rolldownOptions: { input: Object.fromEntries(siteEntries.map(page => [page.replace('.html', ''), join(source, page)])) },
  },
});
// Keep original asset names, manifests and license notices, including lazily loaded character packs.
// The public tree is under Pages' 1 GB site limit and contains no environment or server files.
for (const entry of await readdir(join(source, 'public'))) {
  await cp(join(source, 'public', entry), join(output, entry), { recursive: true, force: false, errorOnExist: true });
}
await writeFile(join(output, '.nojekyll'), '');
// The site root is the public homepage. Anything beyond a language choice belongs to the creator page.
await writeFile(join(output, 'index.html'), `<!doctype html>
<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>AI Fighter</title>
<script>
const params = new URLSearchParams(location.search); params.delete("lang");
location.replace(([...params].length || location.hash ? "./creator.html" : "./league.html") + location.search + location.hash);
</script>
<a href="./league.html">AI Fighter 열기 · Open AI Fighter</a></html>
`);
// The game's public 404 belongs to another site and links to the domain root, which is not ours.
await writeFile(join(output, '404.html'), `<!doctype html>
<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>AI Fighter · 페이지를 찾을 수 없습니다</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#14212d;color:#f5f2e9;font:16px/1.6 Arial,sans-serif;text-align:center}h1{font-size:28px;margin:0 0 12px}a{color:#e9f56a}</style>
<main><h1>페이지를 찾을 수 없습니다 · Page not found</h1>
<p><a href="${config.base}league.html">AI Fighter 홈으로 · Back to AI Fighter</a></p></main></html>
`);
const assets = await readdir(join(output, 'assets'));
const js = (await Promise.all(assets.filter(f => f.endsWith('.js')).map(f => readFile(join(output, 'assets', f), 'utf8')))).join('\n');
const css = (await Promise.all(assets.filter(f => f.endsWith('.css')).map(f => readFile(join(output, 'assets', f), 'utf8')))).join('\n');
for (const value of [config.apiBase, config.publishableKey, config.gameUrl]) {
  if (!js.includes(value)) throw new Error('Public configuration missing from build');
}
if (js.includes('rupin.pryzm.gg') || js.includes('findthem')) throw new Error('Old host dependency found in build');
for (const font of ['Pretendard-Regular.woff2', 'Pretendard-Bold.woff2']) {
  if (!css.includes(`${config.base}fonts/${font}`)) throw new Error(`Incorrect deployed font URL: ${font}`);
}
assertSameRevision(revision, buildRevision(source, hostingRoot));
const release = {
  buildId: randomUUID(), siteUrl: config.siteUrl, builtAt,
  ...revision, dirty: false,
  ...await fingerprint(output),
};
await writeFile(join(output, 'deployment.json'), JSON.stringify(release, null, 2) + '\n');
console.log(JSON.stringify({ output, ...release, checks: 'public-config-and-font-paths-passed' }));
