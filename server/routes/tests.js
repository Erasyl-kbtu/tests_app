import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getTestWithQuestions } from '../db.js';
import { getTestsFolderPath, importTestsFromFolder } from '../importer.js';
import { syncFromGithub } from '../sync.js';

function validateTestPayload(body) {
  if (!body || typeof body.title !== 'string' || !body.title.trim()) {
    return 'Укажите название теста';
  }
  if (!Array.isArray(body.questions) || body.questions.length === 0) {
    return 'Добавьте хотя бы один вопрос';
  }

  for (let i = 0; i < body.questions.length; i++) {
    const q = body.questions[i];
    const num = i + 1;
    if (!q || typeof q.text !== 'string' || !q.text.trim()) {
      return `Вопрос №${num}: введите текст вопроса`;
    }
    if (q.type !== 'single' && q.type !== 'multiple') {
      return `Вопрос №${num}: неверный тип вопроса`;
    }
    if (!Array.isArray(q.options) || q.options.length < 2) {
      return `Вопрос №${num}: добавьте минимум 2 варианта ответа`;
    }
    const validOptions = q.options.filter((o) => o && typeof o.text === 'string' && o.text.trim());
    if (validOptions.length < 2) {
      return `Вопрос №${num}: заполните минимум 2 варианта ответа`;
    }
    const correctCount = validOptions.filter((o) => Boolean(o.isCorrect)).length;
    if (correctCount === 0) {
      return `Вопрос №${num}: отметьте хотя бы один правильный ответ`;
    }
    if (q.type === 'single' && correctCount > 1) {
      return `Вопрос №${num}: для типа «Один правильный» должен быть выбран ровно 1 правильный ответ`;
    }
  }
  return null;
}

function normalizeQuestions(questions) {
  return questions.map((q, idx) => ({
    id: q.id && typeof q.id === 'string' ? q.id : crypto.randomUUID(),
    order_index: idx,
    text: q.text.trim(),
    type: q.type,
    time_limit: Math.max(5, Math.min(300, Number(q.time_limit) || 30)),
    points: Math.max(10, Math.min(1000, Number(q.points) || 100)),
    options: q.options
      .filter((o) => o && typeof o.text === 'string' && o.text.trim())
      .map((o, optIdx) => ({
        id: o.id && typeof o.id === 'string' ? o.id : String.fromCharCode(97 + optIdx),
        text: o.text.trim(),
        isCorrect: Boolean(o.isCorrect),
      })),
  }));
}

export function createTestsRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const rows = db
      .prepare(`
        SELECT t.*, COUNT(q.id) AS question_count
        FROM tests t
        LEFT JOIN questions q ON q.test_id = t.id
        GROUP BY t.id
        ORDER BY t.updated_at DESC
      `)
      .all();
    res.json(rows);
  });

  router.post('/import-folder', (req, res) => {
    const result = importTestsFromFolder(db);
    res.json(result);
  });

  router.get('/sync-config', (req, res) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'sync_github_repo'").get();
    res.json({ githubRepo: row?.value || '' });
  });

  router.post('/sync-github', async (req, res) => {
    const githubRepo = String(req.body?.githubRepo || '').trim();
    if (!githubRepo) {
      db.prepare("DELETE FROM settings WHERE key = 'sync_github_repo'").run();
      return res.json({ githubRepo: '', downloaded: 0, imported: [], skipped: [], errors: [] });
    }

    try {
      const result = await syncFromGithub(db, githubRepo);
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('sync_github_repo', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(githubRepo);
      res.json({ githubRepo, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/upload', (req, res) => {
    const { fileName, contentBase64 } = req.body || {};
    if (!fileName || !contentBase64) {
      return res.status(400).json({ error: 'Выберите файл для загрузки' });
    }

    const safeName = path.basename(String(fileName));
    const ext = path.extname(safeName).toLowerCase();
    if (!['.txt', '.md', '.json', '.docx'].includes(ext)) {
      return res.status(400).json({ error: 'Поддерживаются только файлы .txt, .docx, .md и .json' });
    }

    const folderPath = getTestsFolderPath();
    fs.mkdirSync(folderPath, { recursive: true });
    // If file with same source_file exists, allow re-import under unique name or overwrite
    const targetName = db.prepare('SELECT id FROM tests WHERE source_file = ?').get(safeName)
      ? `${path.basename(safeName, ext)}_${Date.now()}${ext}`
      : safeName;

    fs.writeFileSync(path.join(folderPath, targetName), Buffer.from(contentBase64, 'base64'));
    const result = importTestsFromFolder(db, folderPath);
    res.json(result);
  });

  router.get('/export-all.json', (req, res) => {
    const testRows = db.prepare('SELECT id FROM tests ORDER BY created_at ASC').all();
    const allTests = testRows.map((r) => getTestWithQuestions(db, r.id));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="altyn-tests-backup.json"');
    res.send(JSON.stringify(allTests, null, 2));
  });

  router.get('/:id', (req, res) => {
    const test = getTestWithQuestions(db, req.params.id);
    if (!test) {
      return res.status(404).json({ error: 'Тест не найден' });
    }
    res.json(test);
  });

  router.post('/', (req, res) => {
    const error = validateTestPayload(req.body);
    if (error) {
      return res.status(400).json({ error });
    }

    const now = new Date().toISOString();
    const testId = crypto.randomUUID();
    const questions = normalizeQuestions(req.body.questions);

    db.exec('BEGIN');
    try {
      db.prepare(
        'INSERT INTO tests (id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(testId, req.body.title.trim(), (req.body.description || '').trim(), now, now);

      const insertQ = db.prepare(
        'INSERT INTO questions (id, test_id, order_index, text, type, options_json, time_limit, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const q of questions) {
        insertQ.run(
          q.id,
          testId,
          q.order_index,
          q.text,
          q.type,
          JSON.stringify(q.options),
          q.time_limit,
          q.points
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.status(201).json(getTestWithQuestions(db, testId));
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT id FROM tests WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Тест не найден' });
    }

    const error = validateTestPayload(req.body);
    if (error) {
      return res.status(400).json({ error });
    }

    const now = new Date().toISOString();
    const questions = normalizeQuestions(req.body.questions);

    db.exec('BEGIN');
    try {
      db.prepare(
        'UPDATE tests SET title = ?, description = ?, updated_at = ? WHERE id = ?'
      ).run(req.body.title.trim(), (req.body.description || '').trim(), now, req.params.id);

      db.prepare('DELETE FROM questions WHERE test_id = ?').run(req.params.id);

      const insertQ = db.prepare(
        'INSERT INTO questions (id, test_id, order_index, text, type, options_json, time_limit, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const q of questions) {
        insertQ.run(
          q.id,
          req.params.id,
          q.order_index,
          q.text,
          q.type,
          JSON.stringify(q.options),
          q.time_limit,
          q.points
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.json(getTestWithQuestions(db, req.params.id));
  });

  router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM tests WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Тест не найден' });
    }
    res.json({ ok: true });
  });

  return router;
}
