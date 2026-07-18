import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';

export { uuidv4 };

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this-in-production';
export const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function createToken(payload: object): string {
  // @ts-ignore
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

export function verifyToken(token: string): any {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Express middleware: requires a valid student token
export function requireStudent(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }
  const decoded = verifyToken(token);
  if (!decoded || decoded.role !== 'student') {
    res.status(401).json({ error: 'Invalid session' });
    return;
  }
  (req as any).user = decoded;
  next();
}

// Express middleware: requires a valid teacher token
// Accepts the token either via Authorization header or a ?token= query param
// (needed for plain <a href> download links, e.g. Excel export).
export function requireTeacher(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token =
    (header.startsWith('Bearer ') ? header.slice(7) : null) ||
    (req.query.token as string) ||
    null;
  if (!token) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }
  const decoded = verifyToken(token);
  if (!decoded || decoded.role !== 'teacher') {
    res.status(401).json({ error: 'Invalid session' });
    return;
  }
  (req as any).user = decoded;
  next();
}
