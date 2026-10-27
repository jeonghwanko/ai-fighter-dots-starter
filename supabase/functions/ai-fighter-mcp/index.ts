import { createClient } from '@supabase/supabase-js';
import { createCloudHandler } from '../../../mcp/cloud.mjs';

const url = Deno.env.get('SUPABASE_URL'), secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !secret) throw new Error('Missing server credentials');
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createCloudHandler({ db }));
