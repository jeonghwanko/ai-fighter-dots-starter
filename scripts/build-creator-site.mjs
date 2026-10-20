import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PUBLIC_CREATOR_PAGE } from '../mcp/creator-handoff.mjs';

// Build the AI Fighter entries with explicit public settings, without loading source .env files.
const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) throw new Error('Usage: node scripts/build-creator-site.mjs <kaito_web> <empty-output-directory>');
const source = resolve(sourceArg), output = resolve(outputArg);
const config = JSON.parse(await readFile(new URL('../deploy/creator-site.json', import.meta.url), 'utf8'));
if (config.siteUrl !== PUBLIC_CREATOR_PAGE) throw new Error('Hosting URL must match the MCP homepage');
if (!config.publishableKey.startsWith('sb_publishable_')) throw new Error('A public publishable key is required');
await readFile(join(source, 'creator.html'));
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('Output directory must be empty');
const { build } = await import(pathToFileURL(join(source, 'node_modules/vite/dist/node/index.js')).href);
await build({
  configFile: false, root: source, envDir: false, base: config.base,
  plugins: [{
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
    rolldownOptions: { input: { creator: join(source, 'creator.html'), fighter: join(source, 'fighter.html'), league: join(source, 'league.html') } },
  },
});
// Keep original asset names, manifests and license notices, including lazily loaded character packs.
// The public tree is under Pages' 1 GB site limit and contains no environment or server files.
for (const entry of await readdir(join(source, 'public'))) {
  await cp(join(source, 'public', entry), join(output, entry), { recursive: true, force: false, errorOnExist: true });
}
await writeFile(join(output, '.nojekyll'), '');
await writeFile(join(output, 'index.html'), `<!doctype html>
<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>AI Fighter</title>
<script>location.replace("./creator.html" + location.search + location.hash)</script>
<a href="./creator.html">AI Fighter 열기</a></html>
`);
const assets = await readdir(join(output, 'assets'));
const js = (await Promise.all(assets.filter(f => f.endsWith('.js')).map(f => readFile(join(output, 'assets', f), 'utf8')))).join('\n');
const css = (await Promise.all(assets.filter(f => f.endsWith('.css')).map(f => readFile(join(output, 'assets', f), 'utf8')))).join('\n');
for (const value of [config.apiBase, config.publishableKey, config.gameUrl]) {
  if (!js.includes(value)) throw new Error('Public configuration missing from build');
}
if (/sb_secret_[A-Za-z0-9_-]{20,}/.test(js)) throw new Error('Private key found in build');
if (js.includes('rupin.pryzm.gg') || js.includes('findthem')) throw new Error('Old host dependency found in build');
for (const token of js.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); } catch { continue; }
  if (claims.role === 'service_role') throw new Error('Private JWT found in build');
}
for (const font of ['Pretendard-Regular.woff2', 'Pretendard-Bold.woff2']) {
  if (!css.includes(`${config.base}fonts/${font}`)) throw new Error(`Incorrect deployed font URL: ${font}`);
}
console.log(JSON.stringify({ output, siteUrl: config.siteUrl, assets: assets.length, checks: 'public-config-and-font-paths-passed' }));
