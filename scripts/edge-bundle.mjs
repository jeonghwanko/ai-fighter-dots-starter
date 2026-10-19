import { readFile } from 'node:fs/promises';
const names = ['supabase/functions/ai-fighter/index.ts', 'supabase/functions/ai-fighter/deno.json', 'supabase/functions/ai-fighter/deno.lock',
  'api/handler.mjs', 'contracts/ai-fighter/validate.mjs', 'contracts/ai-fighter/v1/spec.json', 'contracts/ai-fighter/v1/fighter.schema.json'];
const files = await Promise.all(names.map(async name => ({ name, content: await readFile(new URL(`../${name}`, import.meta.url), 'utf8') })));
console.log(JSON.stringify({ name: 'ai-fighter', entrypoint_path: names[0], import_map_path: names[1], verify_jwt: false, files }));
