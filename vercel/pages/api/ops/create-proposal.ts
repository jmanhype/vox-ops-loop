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

    const { dedupeKey, source, template } = req.body || {};

    if (!source || !template) {
      return res.status(400).json({ error: 'Missing source or template' });
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase.rpc('ops_create_proposal_and_maybe_autoapprove', {
      p_dedupe_key: dedupeKey || null,
      p_source: source,
      p_template: template,
    });

    if (error) throw error;

    return res.status(200).json({ ok: true, result: data?.[0] || null });
  } catch (err: any) {
    const status = err?.statusCode || 500;
    return res.status(status).json({ error: err?.message || 'Unknown error' });
  }
}
