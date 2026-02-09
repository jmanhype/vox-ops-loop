#!/usr/bin/env node
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  // First, check why the pulse missions failed
  const failedIds = ['ee3d363c-b380-4195-b0a4-f6cb99ec9e33', 'b1a99fdf-e9dc-4245-9582-c870ba33b71e'];

  for (const missionId of failedIds) {
    console.log(`\n=== MISSION ${missionId.slice(0,8)} STEPS ===`);
    const { data: steps } = await supabase
      .from('ops_mission_steps')
      .select('id, kind, executor, status, last_error, created_at')
      .eq('mission_id', missionId)
      .order('created_at', { ascending: true });

    if (steps?.length) {
      steps.forEach((s, i) => console.log(`  Step ${i}: ${s.kind} (${s.executor}) → ${s.status}${s.last_error ? ' | Error: ' + s.last_error.slice(0,100) : ''}`));
    } else {
      console.log('  (no steps)');
    }
  }

  // Now create a fresh event to re-trigger vox-pulse
  console.log('\n=== CREATING FRESH VOX-PULSE EVENT ===');
  const { data: event, error } = await supabase
    .from('ops_agent_events')
    .insert({
      type: 'user:request',
      data: {
        prompt: "Build 'Vox-Pulse' — A real-time service uptime monitor and status page. Pings registered URLs on configurable intervals, records response time and HTTP status. Dashboard shows live green/red status cards, sparkline response time charts, and uptime percentage. Status changes push to connected clients via Socket.IO. Zero database — pure RAM-based rolling 24-hour window.",
        chat_id: '643905554'
      }
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating event:', error);
  } else {
    console.log(`Created event ${event.id}`);
    console.log('Heartbeat should pick this up in the next tick (2s)');
  }
}

main().catch(console.error);
