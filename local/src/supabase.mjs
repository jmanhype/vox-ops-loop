import { createClient } from '@supabase/supabase-js';

let cached = null;

export function getSupabaseAdmin() {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export async function getPolicyValue(key, fallback = null) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('ops_policy')
    .select('value')
    .eq('key', key)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data?.value ?? fallback;
}
