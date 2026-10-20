import { createClient } from '@supabase/supabase-js';
import { createHandler } from '../../../api/handler.mjs';
import { createCreatorLink } from '../../../api/creator-link.mjs';
import { simulateDuel, engineVersion } from './duel-engine.mjs';

const url = Deno.env.get('SUPABASE_URL');
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !secret) throw new Error('Missing server credentials');
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createHandler({ db, simulateDuel, engineVersion, creatorLink: createCreatorLink({ db }) }));
