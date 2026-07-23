// Arabic Trivia — Kahoot-style server.
// Single Node process: static files + WebSocket + server-side QR generation.
// One global game room per server.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const db = require('./lib/db');
const admin = require('./lib/admin');

const PORT = parseInt(process.env.PORT, 10) || 3000;

// ── Load questions from SQLite ─────────────────────────────────────────────

let QUESTIONS = [];
let SETTINGS = { timePerQuestion: 20, showCorrectAnswer: true };
let META = { title: 'لعبة المعلومات', subtitle: '' };

async function loadQuestions() {
  try {
    await db.init();
    const rows = db.listAll();
    QUESTIONS = rows.map((q) => ({
      id: q.id,
      question: String(q.question || '').trim(),
      choices: (q.choices || []).map((c) => ({
        text: String(c.text || '').trim(),
        correct: !!c.correct,
      })),
    }));
    // Validate every question (defensive — DB inserts are also validated)
    for (const q of QUESTIONS) {
      if (q.choices.length < 2 || q.choices.length > 6) {
        throw new Error(`Question #${q.id} must have 2-6 choices`);
      }
      const correctCount = q.choices.filter((c) => c.correct).length;
      if (correctCount !== 1) {
        throw new Error(`Question #${q.id} must have exactly one correct answer`);
      }
    }
    // Meta lives in code (rarely changes); per-question categories live in DB.
    SETTINGS = { timePerQuestion: parseInt(process.env.TIME_PER_QUESTION, 10) || 20, showCorrectAnswer: true };
    META = { title: process.env.GAME_TITLE || 'لعبة المعلومات', subtitle: process.env.GAME_SUBTITLE || 'اختبر معلوماتك' };
    console.log(`✓ Loaded ${QUESTIONS.length} questions from ${db.DB_PATH}`);
  } catch (e) {
    console.error(`✗ Failed to load questions: ${e.message}`);
    // Don't crash the server — admin UI is still up and can fix the DB.
    QUESTIONS = [];
  }
}

// ── Game state ──────────────────────────────────────────────────────────────

const game = {
  code: null,
  host: null,           // ws of host client
  hostConnected: false,
  players: new Map(),   // name -> { ws, score }
  state: 'lobby',       // lobby | asking | reveal | leaderboard | end
  currentQIndex: -1,
  questionStartTime: 0,
  answers: new Map(),   // name -> choiceIndex
  timer: null,
  tickTimer: null,
};

const SHAPES = ['▲', '◆', '●', '■', '★', '⬢'];

function generateCode() {
  // 4 chars, no ambiguous (no 0/O/1/I)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function makeUniqueName(base) {
  if (!game.players.has(base)) return base;
  let i = 2;
  while (game.players.has(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

function findPlayerByWs(ws) {
  for (const [name, p] of game.players) if (p.ws === ws) return name;
  return null;
}

function getPlayersList() {
  return Array.from(game.players, ([name, p]) => ({ name, score: p.score }));
}

function getSortedPlayers() {
  return getPlayersList().sort((a, b) => b.score - a.score);
}

function sendTo(ws, msg) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)); } catch (_) {}
  }
}

function broadcastToHost(msg)  { sendTo(game.host, msg); }
function broadcastToPlayers(msg) {
  for (const p of game.players.values()) sendTo(p.ws, msg);
}

// ── Game flow ───────────────────────────────────────────────────────────────

function startGame() {
  if (game.players.size === 0) return;
  game.state = 'asking';
  game.currentQIndex = 0;
  nextQuestion();
}

function nextQuestion() {
  if (game.currentQIndex >= QUESTIONS.length) {
    endGame();
    return;
  }
  game.state = 'asking';
  game.answers.clear();
  game.questionStartTime = Date.now();
  const q = QUESTIONS[game.currentQIndex];
  const payload = {
    type: 'question',
    index: game.currentQIndex,
    total: QUESTIONS.length,
    question: q.question,
    choices: q.choices.map((c, i) => ({ text: c.text, shape: SHAPES[i] || '◆' })),
    duration: SETTINGS.timePerQuestion,
  };
  broadcastToHost(payload);
  broadcastToPlayers(payload);

  // Server-authoritative timer.
  if (game.timer) clearTimeout(game.timer);
  game.timer = setTimeout(revealAnswers, SETTINGS.timePerQuestion * 1000);

  // Tick broadcasts for the on-screen countdown.
  if (game.tickTimer) clearInterval(game.tickTimer);
  let remaining = SETTINGS.timePerQuestion;
  game.tickTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) { clearInterval(game.tickTimer); game.tickTimer = null; return; }
    broadcastToHost({ type: 'tick', remaining });
    broadcastToPlayers({ type: 'tick', remaining });
  }, 1000);
}

function revealAnswers() {
  if (game.timer) { clearTimeout(game.timer); game.timer = null; }
  if (game.tickTimer) { clearInterval(game.tickTimer); game.tickTimer = null; }
  if (game.state !== 'asking') return; // already advanced
  game.state = 'reveal';
  const q = QUESTIONS[game.currentQIndex];
  const correctIndex = q.choices.findIndex((c) => c.correct);
  const duration = SETTINGS.timePerQuestion;

  // Score every player (correct, wrong, didn't-answer). Points are based on
  // how FAST the player answered (their tap time), not when reveal fires.
  for (const [name, p] of game.players) {
    const ans = game.answers.get(name);
    if (!ans) {
      sendTo(p.ws, { type: 'answer:result', status: 'no_answer', correct: false, points: 0, total: p.score, correctIndex });
    } else if (ans.choice === correctIndex) {
      const points = Math.max(0, Math.round(1000 * (1 - ans.time / duration)));
      p.score += points;
      sendTo(p.ws, { type: 'answer:result', status: 'correct', correct: true, points, total: p.score, correctIndex });
    } else {
      sendTo(p.ws, { type: 'answer:result', status: 'wrong', correct: false, points: 0, total: p.score, correctIndex });
    }
  }

  const counts = q.choices.map((_, i) => {
    let n = 0;
    for (const c of game.answers.values()) if (c === i) n++;
    return n;
  });

  broadcastToHost({ type: 'reveal', correctIndex, counts, total: game.players.size });
  broadcastToPlayers({ type: 'reveal', correctIndex });
}

function showLeaderboard() {
  game.state = 'leaderboard';
  const sorted = getSortedPlayers();
  broadcastToHost({ type: 'leaderboard', players: sorted });
  broadcastToPlayers({ type: 'leaderboard', players: sorted });
}

function hostNext() {
  if (game.state === 'reveal')      showLeaderboard();
  else if (game.state === 'leaderboard') { game.currentQIndex++; nextQuestion(); }
}

function endGame() {
  if (game.timer) { clearTimeout(game.timer); game.timer = null; }
  if (game.tickTimer) { clearInterval(game.tickTimer); game.tickTimer = null; }
  game.state = 'end';
  const final = getSortedPlayers();
  broadcastToHost({ type: 'game:end', players: final });
  broadcastToPlayers({ type: 'game:end', players: final });
}

function resetGame() {
  if (game.timer) { clearTimeout(game.timer); game.timer = null; }
  if (game.tickTimer) { clearInterval(game.tickTimer); game.tickTimer = null; }
  for (const p of game.players.values()) {
    sendTo(p.ws, { type: 'game:reset', code: game.code });
  }
  game.players.clear();
  game.answers.clear();
  game.state = 'lobby';
  game.currentQIndex = -1;
  sendTo(game.host, { type: 'host:state', phase: 'lobby', code: game.code, players: [] });
}

// ── WebSocket ───────────────────────────────────────────────────────────────

function handleHostMessage(ws, msg) {
  switch (msg.type) {
    case 'host:hello': {
      // Reject only if there's a *live* host. If the previous host's socket
      // is closed but we never got the close event (e.g. browser crashed),
      // game.hostConnected can be stale. Check the socket's actual state.
      if (game.host && game.host !== ws) {
        const live = game.host.readyState === 1 && game.hostConnected;
        if (live) {
          sendTo(ws, { type: 'host:error', reason: 'host_busy' });
          return;
        }
        // Stale reference — drop it and let the new ws claim the host slot.
        game.host = null;
        game.hostConnected = false;
      }
      game.host = ws;
      game.hostConnected = true;
      sendTo(ws, {
        type: 'host:state',
        phase: game.state,
        code: game.code,
        title: META.title,
        subtitle: META.subtitle,
        currentQIndex: game.currentQIndex,
        totalQuestions: QUESTIONS.length,
        settings: SETTINGS,
        meta: META,
        players: getPlayersList(),
      });
      break;
    }
    case 'host:start':   if (game.state === 'lobby')      startGame();     break;
    case 'host:next':    if (game.state === 'reveal' || game.state === 'leaderboard') hostNext(); break;
    case 'host:restart': resetGame(); break;
  }
}

function handlePlayerMessage(ws, msg) {
  switch (msg.type) {
    case 'player:join': {
      if (msg.code !== game.code) {
        sendTo(ws, { type: 'player:error', reason: 'invalid_code' });
        return;
      }
      if (game.state !== 'lobby') {
        sendTo(ws, { type: 'player:error', reason: 'game_started' });
        return;
      }
      const clean = (msg.name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
      if (!clean) {
        sendTo(ws, { type: 'player:error', reason: 'invalid_name' });
        return;
      }
      const finalName = makeUniqueName(clean);
      game.players.set(finalName, { ws, score: 0 });
      sendTo(ws, { type: 'player:joined', name: finalName, code: game.code });
      broadcastToHost({ type: 'player:joined', name: finalName, count: game.players.size, players: getPlayersList() });
      break;
    }
    case 'player:answer': {
      if (game.state !== 'asking') return;
      const name = findPlayerByWs(ws);
      if (!name) return;
      const choice = msg.choice;
      if (typeof choice !== 'number' || choice < 0 || choice >= QUESTIONS[game.currentQIndex].choices.length) return;
      // Allow changing the answer: overwrite with the latest choice + tap time.
      // Points on reveal will be based on this latest tap time.
      const elapsed = (Date.now() - game.questionStartTime) / 1000;
      const wasFirst = !game.answers.has(name);
      game.answers.set(name, { choice, time: elapsed });
      // Only bump the "answered" count for the first answer; subsequent
      // updates don't change who has answered, just what they picked.
      if (wasFirst) {
        broadcastToHost({ type: 'player:answered', name, count: game.answers.size, total: game.players.size });
      } else {
        broadcastToHost({ type: 'player:changed', name, choice });
      }
      break;
    }
  }
}

// ── HTTP server ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/' || pathname === '/index.html') {
      const code = url.searchParams.get('code') || '';
      return serveFile(res, path.join(__dirname, 'public', 'player.html'), 'text/html; charset=utf-8',
        (html) => html.replace('{{INITIAL_CODE}}', escapeHtml(code)));
    }
    if (pathname === '/host') {
      return await serveHostPage(res, req);
    }
    if (pathname === '/admin' || pathname === '/admin/') {
      return admin.sendAdminHtml(res);
    }
    if (pathname.startsWith('/admin/api/')) {
      return admin.handleAdminApi(req, res);
    }
    if (pathname.startsWith('/static/')) {
      return serveStatic(res, path.join(__dirname, 'public', pathname.slice(8)));
    }
    if (pathname === '/api/meta') {
      return json(res, { code: game.code, ip: getLocalIp(), port: PORT, title: META.title });
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server error: ' + e.message);
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (_) { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type.startsWith('host:'))    handleHostMessage(ws, msg);
    else if (msg.type.startsWith('player:')) handlePlayerMessage(ws, msg);
  });

  ws.on('close', () => {
    if (ws === game.host) {
      game.hostConnected = false;
      // If no new host connects within 5s, end the game and bounce everyone
      // back to the lobby. This keeps stale "game in progress" state from
      // poisoning the next host (e.g. when a browser tab was force-killed).
      if (game._hostGoneTimer) clearTimeout(game._hostGoneTimer);
      game._hostGoneTimer = setTimeout(() => {
        if (!game.hostConnected) {
          resetGame();
          game.host = null;
        }
      }, 5000);
    } else {
      const name = findPlayerByWs(ws);
      if (name) {
        game.players.delete(name);
        game.answers.delete(name);
        broadcastToHost({ type: 'player:left', name, count: game.players.size, players: getPlayersList() });
      }
    }
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function serveFile(res, filePath, contentType, transform) {
  fs.readFile(filePath, 'utf8', (err, content) => {
    if (err) { res.writeHead(500); res.end('Error'); return; }
    if (transform) content = transform(content);
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
    res.end(content);
  });
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      '.css': 'text/css; charset=utf-8',
      '.js':  'application/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.ico': 'image/x-icon',
      '.html': 'text/html; charset=utf-8',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function json(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function serveHostPage(res, req) {
  // Use the public host the client reached us through (works for both local
  // LAN and Cloudflare Tunnel / reverse-proxy setups). Fall back to the LAN
  // IP if there's no Host header.
  const host = (req && req.headers && req.headers.host) || `${getLocalIp()}:${PORT}`;
  const proto = (req && req.headers && req.headers['x-forwarded-proto']) || 'http';
  const joinUrl = `${proto}://${host}/?code=${game.code}`;
  const qrSvg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, width: 240, color: { dark: '#0b0820', light: '#ffffff' } });
  fs.readFile(path.join(__dirname, 'public', 'host.html'), 'utf8', (err, html) => {
    if (err) { res.writeHead(500); res.end('Error'); return; }
    html = html
      .replaceAll('{{QR_SVG}}', qrSvg)
      .replaceAll('{{JOIN_URL}}', joinUrl)
      .replaceAll('{{LOCAL_IP}}', host.split(':')[0])
      .replaceAll('{{PORT}}', String(PORT))
      .replaceAll('{{CODE}}', escapeHtml(game.code))
      .replaceAll('{{TITLE}}', escapeHtml(META.title))
      .replaceAll('{{SUBTITLE}}', escapeHtml(META.subtitle || ''));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(html);
  });
}

// ── Start ───────────────────────────────────────────────────────────────────

game.code = generateCode();
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIp();
  const banner = '🎮  Arabic Trivia';
  console.log('');
  console.log(banner);
  console.log('─'.repeat(banner.length + 2));
  console.log(`   TV / Host :  http://${ip}:${PORT}/host`);
  console.log(`   Players   :  http://${ip}:${PORT}/`);
  console.log(`   Game code :  ${game.code}`);
  console.log('─'.repeat(banner.length + 2));
  console.log('   Tip: open the TV URL on the big screen, then scan the QR with phones.');
  console.log('');
});

// DB init runs after listen so the port is bound even if sql.js is slow to
// load the WASM. Once init resolves we load questions and register the
// hot-reload watcher.
(async () => {
  await loadQuestions();
  // Hot-reload when the DB file changes. The primary write path is /admin.
  fs.watchFile(db.DB_PATH, { interval: 1000 }, () => {
    console.log('⟳ DB changed — reloading questions…');
    loadQuestions().then(() => {
      if (game.state !== 'lobby' && game.state !== 'end') {
        endGame();
      }
    });
  });
})();
