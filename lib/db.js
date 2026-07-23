// SQLite-backed question store for the trivia game.
//
// Storage: a single file at $DATA_DIR/questions.db (default ./data/questions.db).
// On Railway mount a persistent volume at /data. Locally ./data.
//
// Uses sql.js (pure WASM) so there's no native module to compile on
// Railway / Vercel / any Linux. Works on macOS, Windows, Linux, containers.
// Tradeoff vs. better-sqlite3: ~2-3x slower on large writes, but our
// write volume is tiny (admin edits) so it's a non-issue.

const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'questions.db');

let initPromise = null;
let SQL = null;
let db = null;

function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const initSqlJs = require('sql.js');
    SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
      db.run(`
        CREATE TABLE questions (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          question    TEXT NOT NULL,
          choices     TEXT NOT NULL,
          difficulty  TEXT NOT NULL DEFAULT 'medium',
          category    TEXT NOT NULL DEFAULT 'general',
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_questions_difficulty ON questions(difficulty);
        CREATE INDEX idx_questions_category   ON questions(category);
      `);
      // Seed from questions.json on first run so fresh deploys are useful.
      const seedPath = path.join(__dirname, '..', 'questions.json');
      if (fs.existsSync(seedPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
          if (Array.isArray(data.questions) && data.questions.length) {
            for (const q of data.questions) {
              db.run(
                'INSERT INTO questions (question, choices, difficulty, category) VALUES (?, ?, ?, ?)',
                [q.question, JSON.stringify(q.choices), q.difficulty || 'medium', q.category || 'general']
              );
            }
            console.log(`✓ Seeded ${data.questions.length} questions from questions.json`);
          }
        } catch (e) {
          console.warn('⚠ Failed to seed from questions.json:', e.message);
        }
      }
      save();
    }
    return db;
  })();
  return initPromise;
}

function save() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function rowsToQuestions(stmt) {
  const out = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    r.choices = JSON.parse(r.choices);
    out.push(r);
  }
  stmt.free();
  return out;
}

function rowToQuestion(r) {
  // r.choices is already a parsed array (see rowsToQuestions).
  return {
    id: r.id,
    question: r.question,
    choices: r.choices,
    difficulty: r.difficulty,
    category: r.category,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Read API (sync after init) ──────────────────────────────────────────

function listAll() {
  const stmt = db.prepare('SELECT id, question, choices, difficulty, category, created_at, updated_at FROM questions ORDER BY id ASC');
  const rows = rowsToQuestions(stmt);
  return rows.map(rowToQuestion);
}

function stats() {
  const totalStmt = db.prepare('SELECT COUNT(*) AS n FROM questions');
  totalStmt.step();
  const total = totalStmt.getAsObject().n;
  totalStmt.free();
  const byDifficulty = [];
  const diffStmt = db.prepare('SELECT difficulty, COUNT(*) AS n FROM questions GROUP BY difficulty');
  while (diffStmt.step()) byDifficulty.push(diffStmt.getAsObject());
  diffStmt.free();
  const byCategory = [];
  const catStmt = db.prepare('SELECT category, COUNT(*) AS n FROM questions GROUP BY category ORDER BY n DESC');
  while (catStmt.step()) byCategory.push(catStmt.getAsObject());
  catStmt.free();
  return { total, byDifficulty, byCategory };
}

function getById(id) {
  const stmt = db.prepare('SELECT id, question, choices, difficulty, category, created_at, updated_at FROM questions WHERE id = ?');
  stmt.bind([id]);
  if (!stmt.step()) { stmt.free(); return null; }
  const r = stmt.getAsObject();
  stmt.free();
  // Parse choices here so rowToQuestion can stay defensive.
  r.choices = JSON.parse(r.choices);
  return rowToQuestion(r);
}

// ── Validation (shared by create/update) ────────────────────────────────

function validateQuestionBody(body) {
  if (!body || typeof body !== 'object') throw new Error('Invalid body');
  const q = String(body.question || '').trim();
  if (!q) throw new Error('question is required');
  const choices = Array.isArray(body.choices) ? body.choices : [];
  if (choices.length < 2 || choices.length > 6) {
    throw new Error('choices must have 2 to 6 items');
  }
  const cleaned = choices.map((c) => ({
    text: String(c.text || '').trim(),
    correct: !!c.correct,
  }));
  if (cleaned.some((c) => !c.text)) throw new Error('all choices need text');
  const correctCount = cleaned.filter((c) => c.correct).length;
  if (correctCount !== 1) throw new Error('exactly one choice must be marked correct');
  return {
    question: q,
    choices: cleaned,
    difficulty: ['easy', 'medium', 'hard'].includes(body.difficulty) ? body.difficulty : 'medium',
    category: String(body.category || 'general').trim() || 'general',
  };
}

// ── Write API ───────────────────────────────────────────────────────────

function create(body) {
  const v = validateQuestionBody(body);
  db.run(
    'INSERT INTO questions (question, choices, difficulty, category) VALUES (?, ?, ?, ?)',
    [v.question, JSON.stringify(v.choices), v.difficulty, v.category]
  );
  const idStmt = db.prepare('SELECT last_insert_rowid() AS id');
  idStmt.step();
  const id = idStmt.getAsObject().id;
  idStmt.free();
  save();
  return getById(id);
}

function createMany(list) {
  if (!Array.isArray(list)) throw new Error('bulk expects an array');
  const inserted = [];
  for (const row of list) {
    const v = validateQuestionBody(row);
    db.run(
      'INSERT INTO questions (question, choices, difficulty, category) VALUES (?, ?, ?, ?)',
      [v.question, JSON.stringify(v.choices), v.difficulty, v.category]
    );
    const idStmt = db.prepare('SELECT last_insert_rowid() AS id');
    idStmt.step();
    inserted.push(idStmt.getAsObject().id);
    idStmt.free();
  }
  save();
  return { inserted: inserted.length, ids: inserted };
}

function update(id, body) {
  const v = validateQuestionBody(body);
  const stmt = db.prepare('UPDATE questions SET question = ?, choices = ?, difficulty = ?, category = ?, updated_at = datetime(\'now\') WHERE id = ?');
  stmt.bind([v.question, JSON.stringify(v.choices), v.difficulty, v.category, id]);
  stmt.step();
  const changes = db.getRowsModified();
  stmt.free();
  if (changes === 0) throw new Error('question not found');
  save();
  return getById(id);
}

function remove(id) {
  const stmt = db.prepare('DELETE FROM questions WHERE id = ?');
  stmt.bind([id]);
  stmt.step();
  const changes = db.getRowsModified();
  stmt.free();
  const ok = changes > 0;
  if (ok) save();
  return ok;
}

module.exports = {
  init,
  listAll,
  getById,
  stats,
  create,
  createMany,
  update,
  remove,
  DB_PATH,
  DATA_DIR,
};
