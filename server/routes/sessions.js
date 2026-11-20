import express from 'express';
import crypto from 'node:crypto';
import { getTestWithQuestions } from '../db.js';

function generateRoomCode(db) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const exists = db.prepare('SELECT id FROM sessions WHERE code = ?').get(code);
    if (!exists) return code;
  }
  return String(Date.now()).slice(-6);
}

function escapeCsvCell(value) {
  const str = String(value ?? '');
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function createSessionsRouter(db) {
  const router = express.Router();

  router.post('/', (req, res) => {
    const { testId, mode = 'live' } = req.body || {};
    if (mode !== 'live' && mode !== 'self_paced') {
      return res.status(400).json({ error: 'Неверный режим тестирования' });
    }

    const test = getTestWithQuestions(db, testId);
    if (!test) {
      return res.status(404).json({ error: 'Тест не найден' });
    }
    if (test.questions.length === 0) {
      return res.status(400).json({ error: 'В тесте нет вопросов' });
    }

    const sessionId = crypto.randomUUID();
    const code = generateRoomCode(db);
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO sessions (id, code, test_id, mode, status, current_question_index, question_phase, created_at)
       VALUES (?, ?, ?, ?, 'lobby', -1, 'question', ?)`
    ).run(sessionId, code, testId, mode, now);

    res.status(201).json({
      id: sessionId,
      code,
      testId,
      mode,
      status: 'lobby',
      testTitle: test.title,
    });
  });

  router.get('/by-code/:code', (req, res) => {
    const code = String(req.params.code || '').trim();
    const row = db
      .prepare(`
        SELECT s.id, s.code, s.mode, s.status, t.title AS testTitle, t.description AS testDescription
        FROM sessions s
        JOIN tests t ON t.id = s.test_id
        WHERE s.code = ?
      `)
      .get(code);

    if (!row) {
      return res.status(404).json({ error: 'Комната с таким кодом не найдена' });
    }
    res.json(row);
  });

  router.get('/:id', (req, res) => {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Сессия не найдена' });
    }

    const test = getTestWithQuestions(db, session.test_id);
    const participants = db
      .prepare('SELECT id, name, score, finished, joined_at FROM participants WHERE session_id = ? ORDER BY score DESC, joined_at ASC')
      .all(session.id);

    res.json({
      ...session,
      testTitle: test?.title || '',
      questionCount: test?.questions.length || 0,
      participants,
    });
  });

  router.get('/:id/export.csv', (req, res) => {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Сессия не найдена' });
    }

    const test = getTestWithQuestions(db, session.test_id);
    const participants = db
      .prepare('SELECT * FROM participants WHERE session_id = ? ORDER BY score DESC, name ASC')
      .all(session.id);
    const answers = db
      .prepare('SELECT * FROM answers WHERE session_id = ?')
      .all(session.id);

    const answerMap = new Map();
    for (const a of answers) {
      answerMap.set(`${a.participant_id}:${a.question_id}`, a);
    }

    const headers = [
      'ФИО ученика',
      'Баллы',
      'Правильных ответов',
      'Всего вопросов',
      ...test.questions.map((q, i) => `В${i + 1}: ${q.text}`),
    ];

    const lines = [headers.map(escapeCsvCell).join(';')];

    for (const p of participants) {
      let correctCount = 0;
      const qCells = test.questions.map((q) => {
        const ans = answerMap.get(`${p.id}:${q.id}`);
        if (!ans) return 'Нет ответа';
        if (ans.is_correct) correctCount++;
        return ans.is_correct ? `Верно (+${ans.points_earned})` : 'Неверно (0)';
      });

      const row = [
        p.name,
        p.score,
        correctCount,
        test.questions.length,
        ...qCells,
      ];
      lines.push(row.map(escapeCsvCell).join(';'));
    }

    const csv = '\uFEFF' + lines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="results-${session.code}.csv"`);
    res.send(csv);
  });

  return router;
}
