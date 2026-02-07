
import { getSupabaseAdmin } from '../supabase.mjs';

/**
 * Radar Skill - Manage the product roadmap autonomously.
 */

export async function addToRadar({ title, description, stage = 'watching' }) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('ops_radar')
    .insert({ title, description, stage })
    .select();

  if (error) throw error;
  return data[0];
}

export async function updateRadarStage({ id, title, stage, notes }) {
  const supabase = getSupabaseAdmin();
  let query = supabase.from('ops_radar').update({ stage, updated_at: new Date().toISOString() });
  
  if (id) {
    query = query.eq('id', id);
  } else if (title) {
    query = query.eq('title', title);
  } else {
    throw new Error('Missing id or title for updateRadarStage');
  }

  const { data, error } = await query.select();
  if (error) throw error;
  return data[0];
}

export async function listRadar(stage) {
  const supabase = getSupabaseAdmin();
  let query = supabase.from('ops_radar').select('*').order('updated_at', { ascending: false });
  if (stage) {
    query = query.eq('stage', stage);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
