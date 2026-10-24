import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {content,identity} from '../website/cloud-plugin/content.mjs';
const esc=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function buildCloudPluginSite(siteRoot) {
  const dir=join(siteRoot,'cloud-plugin');await mkdir(dir,{recursive:true});
  const keys=['index','privacy','terms','support'];
  for(const language of ['en','ko']) for(const key of keys) {
    const p=content[language][key],suffix=language==='ko'?'.ko':'',file=key+suffix+'.html';
    const html=`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(p.title)} · ODDBOUT</title><link rel="canonical" href="https://oddbout.com/cloud-plugin/${file}"><link rel="stylesheet" href="./style.css"><header><a class="brand" href="./index${suffix}.html"><img src="/art/ui/oddbout-logo.webp" alt="ODDBOUT Fight Club" width="188" height="38"></a><nav>${keys.map((k,i)=>`<a href="./${k+suffix}.html" ${k===key?'aria-current="page"':''}>${content[language].nav[i]}</a>`).join('')}<a href="./${key+(language==='ko'?'':'.ko')}.html" lang="${language==='ko'?'en':'ko'}">${language==='ko'?'EN':'KR'}</a></nav></header><main><div class="hero"><p class="eyebrow">ODDBOUT CLOUD PLUGIN</p><h1>${esc(p.title)}</h1><p class="intro">${esc(p.intro)}</p><p class="meta">${identity.publisher} · ${identity.effective}</p></div><article>${p.sections.map(([title,text],i)=>`<section><span class="section-number">${String(i+1).padStart(2,'0')}</span><div><h2>${esc(title)}</h2><p>${esc(text)}</p></div></section>`).join('')}</article></main><footer><p>ODDBOUT · ${identity.publisher}</p><a href="mailto:${identity.support}">${identity.support}</a></footer></html>`;
    await writeFile(join(dir,file),html);
  }
  const shared=await readFile(new URL('../website/ai-fighter-creator/style.css',import.meta.url),'utf8');
  await writeFile(join(dir,'style.css'),shared+'\n@font-face{font-family:Pretendard;src:url(/fonts/Pretendard-Regular.woff2);font-weight:400;font-display:swap}@font-face{font-family:Pretendard;src:url(/fonts/Pretendard-Bold.woff2);font-weight:700;font-display:swap}:root{font-family:Pretendard,Arial,sans-serif}article{max-width:800px;margin:45px 0 70px}header nav{flex-wrap:wrap}');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(!process.argv[2])throw new Error('Supply the existing site root');await buildCloudPluginSite(resolve(process.argv[2]));}
