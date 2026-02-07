import type { NextApiRequest } from 'next';

export function requireBearer(req: NextApiRequest): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = process.env.OPS_API_KEY || '';

  if (!token || !expected || token !== expected) {
    const err = new Error('Unauthorized');
    (err as any).statusCode = 401;
    throw err;
  }
}
