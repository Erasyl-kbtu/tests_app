import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sea from 'node:sea';

const __dirname = typeof import.meta?.url === 'string'
  ? path.dirname(fileURLToPath(import.meta.url))
  : process.cwd();

function getDefaultDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  try {
    if (sea.isSea()) {
      return path.join(path.dirname(process.execPath), 'data', 'quiz.db');
    }
  } catch {
    // Ignore if not in SEA
  }
  return path.join(__dirname, '..', 'data', 'quiz.db');
}

export function createDatabase(dbPath = getDefaultDbPath(), { seedDemo = true } = {}) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      source_file TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('single', 'multiple')),
      options_json TEXT NOT NULL,
      time_limit INTEGER NOT NULL DEFAULT 30,
      points INTEGER NOT NULL DEFAULT 100
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK(mode IN ('live', 'self_paced')),
      status TEXT NOT NULL CHECK(status IN ('lobby', 'active', 'finished')) DEFAULT 'lobby',
      current_question_index INTEGER NOT NULL DEFAULT -1,
      question_phase TEXT NOT NULL DEFAULT 'question',
      question_started_at INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      name TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      finished INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL,
      UNIQUE(session_id, token)
    );

    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      selected_option_ids_json TEXT NOT NULL,
      is_correct INTEGER NOT NULL,
      points_earned INTEGER NOT NULL DEFAULT 0,
      answered_at TEXT NOT NULL,
      UNIQUE(participant_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const cols = db.prepare('PRAGMA table_info(tests)').all();
  if (!cols.some((c) => c.name === 'source_file')) {
    db.exec('ALTER TABLE tests ADD COLUMN source_file TEXT;');
  }

  if (seedDemo) {
    const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM tests').get();
    if (countRow.cnt === 0) {
      seedDemoTest(db);
    }
  }

  return db;
}

function seedDemoTest(db) {
  const now = new Date().toISOString();
  const testId = crypto.randomUUID();

  db.prepare(
    'INSERT INTO tests (id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(
    testId,
    'Биология: Строение клетки (Демо-тест)',
    'Пример теста с вопросами на один и несколько правильных ответов',
    now,
    now
  );

  const questions = [
    {
      text: 'Какая органелла отвечает за синтез АТФ (энергетическая станция клетки)?',
      type: 'single',
      time_limit: 25,
      points: 100,
      options: [
        { id: 'a', text: 'Рибосома', isCorrect: false },
        { id: 'b', text: 'Митохондрия', isCorrect: true },
        { id: 'c', text: 'Аппарат Гольджи', isCorrect: false },
        { id: 'd', text: 'Лизосома', isCorrect: false },
      ],
    },
    {
      text: 'Какие структуры есть у растительной клетки, но отсутствуют у животной?',
      type: 'multiple',
      time_limit: 35,
      points: 150,
      options: [
        { id: 'a', text: 'Клеточная стенка из целлюлозы', isCorrect: true },
        { id: 'b', text: 'Хлоропласты', isCorrect: true },
        { id: 'c', text: 'Митохондрии', isCorrect: false },
        { id: 'd', text: 'Крупная центральная вакуоль', isCorrect: true },
      ],
    },
    {
      text: 'Где в эукариотической клетке хранится основная часть ДНК?',
      type: 'single',
      time_limit: 20,
      points: 100,
      options: [
        { id: 'a', text: 'В ядре', isCorrect: true },
        { id: 'b', text: 'В цитоплазме', isCorrect: false },
        { id: 'c', text: 'В комплексе Гольджи', isCorrect: false },
        { id: 'd', text: 'В клеточной мембране', isCorrect: false },
      ],
    },
    {
      text: 'Выберите немембранные органеллы клетки:',
      type: 'multiple',
      time_limit: 30,
      points: 150,
      options: [
        { id: 'a', text: 'Рибосомы', isCorrect: true },
        { id: 'b', text: 'Клеточный центр (центриоли)', isCorrect: true },
        { id: 'c', text: 'Лизосомы', isCorrect: false },
        { id: 'd', text: 'Эндоплазматическая сеть', isCorrect: false },
      ],
    },
  ];

  const insertQ = db.prepare(
    'INSERT INTO questions (id, test_id, order_index, text, type, options_json, time_limit, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  questions.forEach((q, idx) => {
    insertQ.run(
      crypto.randomUUID(),
      testId,
      idx,
      q.text,
      q.type,
      JSON.stringify(q.options),
      q.time_limit,
      q.points
    );
  });
}

export function getTestWithQuestions(db, testId) {
  const test = db.prepare('SELECT * FROM tests WHERE id = ?').get(testId);
  if (!test) return null;

  const rows = db
    .prepare('SELECT * FROM questions WHERE test_id = ? ORDER BY order_index ASC')
    .all(testId);

  return {
    ...test,
    questions: rows.map((r) => ({
      id: r.id,
      test_id: r.test_id,
      order_index: r.order_index,
      text: r.text,
      type: r.type,
      options: JSON.parse(r.options_json),
      time_limit: r.time_limit,
      points: r.points,
    })),
  };
}
