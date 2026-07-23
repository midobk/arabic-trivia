// SQLite-backed question store for the trivia game.
//
// Schema:
//   questions(id, question, choices JSON, difficulty, category, created_at, updated_at)
//
// The DB path is `process.env.DATA_DIR + '/questions.db'`. On Railway
// mount a persistent volume at /data. Locally we use ./data so the file
// is gitignored.
//
// On first run, if the DB is empty, we seed it from questions.json (the
// in-repo default). This keeps "git clone && npm start" working without
// requiring any extra steps.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'questions.db');

let db;

function init() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      question    TEXT NOT NULL,
      choices     TEXT NOT NULL,
      difficulty  TEXT NOT NULL DEFAULT 'medium',
      category    TEXT NOT NULL DEFAULT 'general',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);
    CREATE INDEX IF NOT EXISTS idx_questions_category   ON questions(category);
  `);

  // Seed from questions.json if the table is empty.
  const count = db.prepare('SELECT COUNT(*) AS n FROM questions').get().n;
  if (count === 0) {
    const seedPath = path.join(__dirname, '..', 'questions.json');
    if (fs.existsSync(seedPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
        if (Array.isArray(data.questions) && data.questions.length) {
          const insert = db.prepare(`
            INSERT INTO questions (question, choices, difficulty, category)
            VALUES (?, ?, 'medium', 'general')
          `);
          const insertAll = db.transaction((rows) => {
            for (const r of rows) insert.run(r.question, JSON.stringify(r.choices));
          });
          insertAll(data.questions.map((q) => ({
            question: q.question,
            choices: q.choices,
          })));
          console.log(`✓ Seeded ${data.questions.length} questions from questions.json`);
        }
      } catch (e) {
        console.warn('⚠ Failed to seed from questions.json:', e.message);
      }
    }
  }

  return db;
}

// ── Read API (used by the game server) ────────────────────────────────────

function listAll() {
  init();
  return db.prepare(`
    SELECT id, question, choices, difficulty, category, created_at, updated_at
    FROM questions
    ORDER BY id ASC
  `).all().map(rowToQuestion);
}

function stats() {
  init();
  const total = db.prepare('SELECT COUNT(*) AS n FROM questions').get().n;
  const byDifficulty = db.prepare(`
    SELECT difficulty, COUNT(*) AS n FROM questions GROUP BY difficulty
  `).all();
  const byCategory = db.prepare(`
    SELECT category, COUNT(*) AS n FROM questions GROUP BY category ORDER BY n DESC
  `).all();
  return { total, byDifficulty, byCategory };
}

function rowToQuestion(row) {
  return {
    id: row.id,
    question: row.question,
    choices: JSON.parse(row.choices),
    difficulty: row.difficulty,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Write API (used by the admin UI / agent) ──────────────────────────────

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

function create(body) {
  init();
  const v = validateQuestionBody(body);
  const r = db.prepare(`
    INSERT INTO questions (question, choices, difficulty, category)
    VALUES (?, ?, ?, ?)
  `).run(v.question, JSON.stringify(v.choices), v.difficulty, v.category);
  return getById(r.lastInsertRowid);
}

function createMany(list) {
  init();
  if (!Array.isArray(list)) throw new Error('bulk expects an array');
  const insert = db.prepare(`
    INSERT INTO questions (question, choices, difficulty, category)
    VALUES (?, ?, ?, ?)
  `);
  const inserted = [];
  const insertAll = db.transaction((rows) => {
    for (const row of rows) {
      const v = validateQuestionBody(row);
      const r = insert.run(v.question, JSON.stringify(v.choices), v.difficulty, v.category);
      inserted.push(r.lastInsertRowid);
    }
  });
  insertAll(list);
  return { inserted: inserted.length, ids: inserted };
}

function getById(id) {
  init();
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  return row ? rowToQuestion(row) : null;
}

function update(id, body) {
  init();
  const v = validateQuestionBody(body);
  const r = db.prepare(`
    UPDATE questions
       SET question = ?, choices = ?, difficulty = ?, category = ?,
           updated_at = datetime('now')
     WHERE id = ?
  `).run(v.question, JSON.stringify(v.choices), v.difficulty, v.category, id);
  if (r.changes === 0) throw new Error('question not found');
  return getById(id);
}

function remove(id) {
  init();
  const r = db.prepare('DELETE FROM questions WHERE id = ?').run(id);
  return r.changes > 0;
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
