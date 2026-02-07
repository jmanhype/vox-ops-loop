
import { getSupabaseAdmin } from '../supabase.mjs';

export async function runVote(step) {
  const { params } = step;
  const supabase = getSupabaseAdmin();

  if (!params.proposal_id || !params.agent_role || !params.vote) {
    throw new Error('Vote executor requires proposal_id, agent_role, and vote');
  }

  const { data, error } = await supabase.rpc('ops_cast_vote', {
    p_proposal_id: params.proposal_id,
    p_agent_role: params.agent_role,
    p_vote: params.vote,
    p_reason: params.reason || 'Consensus vote'
  });

  if (error) throw error;

  return { 
    ok: true, 
    result: data,
    stdout: `Vote cast by ${params.agent_role}: ${params.vote}`
  };
}
