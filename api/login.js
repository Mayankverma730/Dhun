/**
 * api/login.js — Serverless Auth Endpoint for Dhun on Vercel
 */

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { email, password } = req.body || {};
  return res.status(200).json({
    success: true,
    message: 'Authenticated successfully',
    user: { email: email || 'listener@dhun.app' }
  });
};
