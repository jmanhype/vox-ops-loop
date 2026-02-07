import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '../../../lib/ops/supabase';
import { requireBearer } from '../../../lib/ops/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    requireBearer(req);

    const { proposalId } = req.body || {};
    if (!proposalId) {
      return res.status(400).json({ error: 'Missing proposalId' });
    }

    const supabase = getSupabaseAdmin();

    const { data: proposal, error: fetchError } = await supabase
      .from('ops_mission_proposals')
      .select('id,status')
      .eq('id', proposalId)
      .single();

    if (fetchError) throw fetchError;
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
    if (proposal.status !== 'pending') {
      return res.status(409).json({ error: 'Proposal is not pending' });
    }

    const { error: updateError } = await supabase
      .from('ops_mission_proposals')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', proposalId);

    if (updateError) throw updateError;

    const { data: missionId, error: missionError } = await supabase.rpc(
      'ops_create_mission_from_proposal',
      { p_proposal_id: proposalId }
    );

    if (missionError) throw missionError;

    return res.status(200).json({ ok: true, missionId });
  } catch (err: any) {
    const status = err?.statusCode || 500;
    return res.status(status).json({ error: err?.message || 'Unknown error' });
  }
}
