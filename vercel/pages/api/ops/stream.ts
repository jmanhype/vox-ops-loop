import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '../../../lib/ops/supabase';
import { requireBearer } from '../../../lib/ops/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    requireBearer(req);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('ops_agent_events')
      .select('id, created_at, thought, data')
      .not('thought', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    return res.status(200).json({ ok: true, stream: data || [] });
  } catch (err: any) {
    const status = err?.statusCode || 500;
    return res.status(status).json({ error: err?.message || 'Unknown error' });
  }
}
