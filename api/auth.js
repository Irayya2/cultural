// auth.js
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this-in-production';
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit code
}

function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Express middleware: requires a valid student token
function requireStudent(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  const decoded = verifyToken(token);
  if (!decoded || decoded.role !== 'student') return res.status(401).json({ error: 'Invalid session' });
  req.user = decoded;
  next();
}

// Express middleware: requires a valid teacher token
// Accepts the token either via Authorization header (normal API calls) or
// a ?token= query param (needed for plain <a href> download links, e.g. Excel export).
function requireTeacher(req, res, next) {
  const header = req.headers.authorization || '';
  const token = (header.startsWith('Bearer ') ? header.slice(7) : null) || req.query.token || null;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  const decoded = verifyToken(token);
  if (!decoded || decoded.role !== 'teacher') return res.status(401).json({ error: 'Invalid session' });
  req.user = decoded;
  next();
}

module.exports = {
  generateOtp,
  createToken,
  verifyToken,
  requireStudent,
  requireTeacher,
  OTP_EXPIRY_MS,
  uuidv4,
};
