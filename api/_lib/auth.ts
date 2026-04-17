import jwt from 'jsonwebtoken';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'change-me-in-production-use-a-random-secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

export interface AdminPayload {
  sub: string;
  role: 'admin';
}

/** Validate username + password against environment variables. */
export function validateCredentials(username: string, password: string): boolean {
  return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

/** Issue a signed JWT valid for 24 hours. */
export function signToken(username: string): string {
  const payload: AdminPayload = { sub: username, role: 'admin' };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

/** Verify a JWT and return the payload, or null if invalid/expired. */
export function verifyToken(token: string): AdminPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AdminPayload;
  } catch {
    return null;
  }
}

/** Extract the Bearer token from the Authorization header. */
function extractToken(req: VercelRequest): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

/**
 * Guard middleware: verifies the Bearer JWT and sets CORS headers.
 * Returns true if the request is authenticated; writes a 401 and returns false otherwise.
 */
export function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return false;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return false;
  }
  return true;
}

/** Add permissive CORS headers (restrict in production if needed). */
export function setCors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', process.env.ADMIN_CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}
