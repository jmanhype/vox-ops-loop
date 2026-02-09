#!/usr/bin/env node
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  console.log('=== RUNNING MISSIONS ===');
  const { data: running } = await supabase.from('ops_missions').select('id, status, created_at').eq('status', 'running');
  console.log(running?.length ? running : '(none)');

  console.log('\n=== FAILED MISSIONS (last 5) ===');
  const { data: failed } = await supabase.from('ops_missions').select('id, status, created_at').eq('status', 'failed').order('created_at', { ascending: false }).limit(5);
  console.log(failed?.length ? failed : '(none)');

  console.log('\n=== SUCCEEDED MISSIONS (last 5) ===');
  const { data: succeeded } = await supabase.from('ops_missions').select('id, status, created_at').eq('status', 'succeeded').order('created_at', { ascending: false }).limit(5);
  console.log(succeeded?.length ? succeeded : '(none)');

  console.log('\n=== UNPROCESSED EVENTS ===');
  const { data: events } = await supabase.from('ops_agent_events').select('id, type, data, created_at').is('processed_at', null).order('created_at', { ascending: false }).limit(10);
  console.log(events?.length ? events.map(e => ({ id: e.id.slice(0,8), type: e.type, prompt: e.data?.prompt?.slice(0,60), created: e.created_at })) : '(none)');

  console.log('\n=== QUEUED STEPS ===');
  const { data: queued } = await supabase.from('ops_mission_steps').select('id, kind, executor, status, mission_id').eq('status', 'queued').limit(10);
  console.log(queued?.length ? queued.map(s => ({ id: s.id.slice(0,8), kind: s.kind, executor: s.executor, mission: s.mission_id.slice(0,8) })) : '(none)');

  console.log('\n=== RUNNING STEPS ===');
  const { data: runningSteps } = await supabase.from('ops_mission_steps').select('id, kind, executor, status, mission_id').eq('status', 'running').limit(10);
  console.log(runningSteps?.length ? runningSteps.map(s => ({ id: s.id.slice(0,8), kind: s.kind, executor: s.executor, mission: s.mission_id.slice(0,8) })) : '(none)');

  console.log('\n=== RECENT EVENTS WITH "pulse" IN PROMPT ===');
  const { data: pulseEvents } = await supabase.from('ops_agent_events').select('id, type, data, processed_at, created_at').order('created_at', { ascending: false }).limit(20);
  const pulse = pulseEvents?.filter(e => JSON.stringify(e.data || {}).toLowerCase().includes('pulse'));
  console.log(pulse?.length ? pulse.map(e => ({ id: e.id.slice(0,8), type: e.type, processed: !!e.processed_at, created: e.created_at })) : '(none with pulse)');
}

main().catch(console.error);
