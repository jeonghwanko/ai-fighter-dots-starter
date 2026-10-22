// Static, dependency-free policy preview. This command does not publish anything.
import { mkdir, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.resolve(process.argv[2] || path.join(root, 'output/plugin-review-20261022/site/ai-fighter-creator'));
const { pages, prepared } = await import('../website/ai-fighter-creator/content.mjs');
await mkdir(destination, { recursive: true });
const nav = [['index.html', 'Overview'], ['privacy.html', 'Privacy'], ['terms.html', 'Terms'], ['support.html', 'Support']];
for (const page of pages) {
  const sections = page.sections.map(([id, heading, body], i) => `<section id="${id}"><span class="section-number">${String(i + 1).padStart(2, '0')}</span><div><h2>${heading}</h2>${body}</div></section>`).join('\n');
  const html = `<!doctype html>
<html lang="${page.lang || 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="strict-origin-when-cross-origin"><title>${page.title} · AI Fighter Creator</title><meta name="description" content="${page.description}"><link rel="stylesheet" href="./style.css"></head>
<body><a class="skip" href="#main">Skip to content</a><header><a class="brand" href="./index.html"><img src="./icon.svg" width="36" height="36" alt=""><span>AI FIGHTER<span class="brand-sub">CREATOR / LUCAS FOUNDATION</span></span></a><nav aria-label="Main">${nav.map(([file, label]) => `<a ${file === page.file ? 'aria-current="page"' : ''} href="./${file}">${label}</a>`).join('')}</nav></header>
<div class="preview">POLICY PREVIEW <span>Prepared ${prepared} · publication pending</span></div>
<main id="main"><div class="hero"><p class="eyebrow">${page.eyebrow}</p><h1>${page.title}</h1><p class="intro">${page.description}</p><div class="meta">Lucas Foundation <span>•</span> ${prepared}${page.translation ? ` <span>•</span> <a href="./${page.translation.file}" lang="${page.translation.lang}">${page.translation.label}</a>` : ''}</div></div>
<div class="layout"><aside aria-label="On this page">${page.sections.map(([id, title]) => `<a href="#${id}">${title}</a>`).join('')}</aside><article>${sections}</article></div></main>
<footer><div><strong>LUCAS FOUNDATION</strong><p>AI Fighter Creator · ODDBOUT</p></div><div><a href="./privacy.html">Privacy</a><a href="./terms.html">Terms</a><a href="./support.html">Support</a><a href="https://github.com/jeonghwanko/ai-fighter-dots-starter">Source code ↗</a></div></footer></body></html>`;
  await writeFile(path.join(destination, page.file), html);
}
await cp(path.join(root, 'website/ai-fighter-creator/style.css'), path.join(destination, 'style.css'));
await cp(path.join(root, 'plugins/ai-fighter/assets/icon.svg'), path.join(destination, 'icon.svg'));
console.log(JSON.stringify({ destination, pages: pages.map(p => p.file), published: false }));
