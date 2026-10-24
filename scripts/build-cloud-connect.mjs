import { cp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildCloudConnect(output) {
  await mkdir(join(output, 'cloud-connect'), { recursive: true });
  await cp(join(root, 'web/cloud-connect/connect.html'), join(output, 'connect.html'));
  for (const name of ['connect.css','connect.mjs']) await cp(join(root, 'web/cloud-connect', name), join(output, 'cloud-connect', name));
  await cp(join(root, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), join(output, 'cloud-connect/supabase.js'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/build-cloud-connect.mjs <site-directory>');
  await buildCloudConnect(resolve(process.argv[2]));
}
