// Vercel serverless entry point.
// This file is ONLY used for the /api/* routes when deployed on Vercel.
// For full multiplayer (WebSocket + in-memory state), run `npm start` locally.
//
// Endpoints exposed here:
//   GET /api/meta   — build metadata, public IP detection, instructions
//   GET /api/health — liveness ping

const { readFileSync } = require('fs');
const { join } = require('path');

let cached = null;
function loadMeta() {
  if (cached) return cached;
  try {
    const data = JSON.parse(
      readFileSync(join(process.cwd(), 'questions.json'), 'utf8')
    );
    cached = {
      title: data.meta?.title || 'لعبة المعلومات',
      subtitle: data.meta?.subtitle || '',
      questionCount: (data.questions || []).length,
      deployedAt: new Date().toISOString(),
    };
  } catch (e) {
    cached = { title: 'لعبة المعلومات', subtitle: '', questionCount: 0, deployedAt: new Date().toISOString() };
  }
  return cached;
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // /api/meta  →  metadata
  // /api/health →  simple ping
  const path = (req.url || '').split('?')[0];
  if (path === '/api/health') {
    return res.status(200).json({ ok: true, ts: Date.now() });
  }
  return res.status(200).json(loadMeta());
};
