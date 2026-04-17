import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateCredentials, signToken, setCors } from '../_lib/auth';

/**
 * POST /api/admin/login
 * Body: { username: string, password: string }
 * Returns: { token: string, expiresIn: string }
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  if (!validateCredentials(String(username), String(password))) {
    // Use a generic message to avoid username enumeration
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken(String(username));
  return res.status(200).json({ token, expiresIn: '24h' });
}
