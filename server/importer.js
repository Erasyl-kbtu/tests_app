import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sea from 'node:sea';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __dirname = typeof import.meta?.url === 'string'
  ? path.dirname(fileURLToPath(import.meta.url))
  : process.cwd();

export function getTestsFolderPath() {
  try {
    if (sea.isSea()) {
      return path.join(path.dirname(process.execPath), 'тесты');
    }
  } catch {
    // Not in SEA
  }
  return path.join(__dirname, '..', 'тесты');
}

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function extractTextFromDocx(filePath) {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) {
    throw new Error('Файл .docx не содержит word/document.xml');
  }
  const xml = entry.getData().toString('utf8');
  const paragraphs = xml.split(/<\/w:p>/);
  return paragraphs
    .map((p) => decodeXmlEntities(p.replace(/<[^>]+>/g, '')).trim())
    .filter(Boolean)
    .join('\n');
}

const LETTER_INDEX_MAP = {
  а: 0, a: 0,
  б: 1, b: 1,
  в: 2, c: 2,
  г: 3, d: 3,
  д: 4, e: 4,
  е: 5, f: 5,
};

export function parseTestText(rawText, fallbackTitle = 'Импортированный тест') {
  const lines = rawText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let title = fallbackTitle;
  let description = '';
  const questions = [];
  let current = null;

  function finalizeCurrent() {
    if (!current) return;
    if (current.answerTokens.length > 0) {
      for (const tok of current.answerTokens) {
        const lower = tok.toLowerCase();
        if (LETTER_INDEX_MAP[lower] !== undefined) {
          const idx = LETTER_INDEX_MAP[lower];
          if (current.options[idx]) current.options[idx].isCorrect = true;
        } else if (/^\d+$/.test(lower)) {
          const idx = Number(lower) - 1;
          if (current.options[idx]) current.options[idx].isCorrect = true;
        }
      }
    }
    if (current.options.length >= 2) {
      const correctCount = current.options.filter((o) => o.isCorrect).length;
      if (correctCount > 0) {
        questions.push({
          text: current.text,
          type: correctCount > 1 ? 'multiple' : 'single',
          time_limit: 30,
          points: correctCount > 1 ? 150 : 100,
          options: current.options.map((o, idx) => ({
            id: String.fromCharCode(97 + idx),
            text: o.text,
            isCorrect: o.isCorrect,
          })),
        });
      }
    }
    current = null;
  }

  for (const line of lines) {
    // Metadata before first question
    if (!current) {
      const titleMatch = line.match(/^(?:название|тема|#)\s*:?\s+(.+)$/i);
      if (titleMatch && !/^\d+[\.\)]/.test(line)) {
        title = titleMatch[1].trim();
        continue;
      }
      const descMatch = line.match(/^описание\s*:\s*(.+)$/i);
      if (descMatch) {
        description = descMatch[1].trim();
        continue;
      }
    }

    // Answer key line at the end of a question block: "Ответ: А" or "Ответы: 1, 3"
    const ansMatch = line.match(/^(?:правильный\s+ответ|ответы?)\s*:\s*(.+)$/i);
    if (current && ansMatch) {
      current.answerTokens = ansMatch[1]
        .split(/[,;\s]+/)
        .map((t) => t.replace(/[\.\)]$/, '').trim())
        .filter(Boolean);
      continue;
    }

    // Option lines: "* ...", "+ ...", "- ...", "[x] ...", "[ ] ...", "А) ...", "a) ..."
    const correctMarkMatch = line.match(/^(?:\*|\+|\[[xXхХ\+]\]|\(\+\))\s*(.+)$/);
    if (current && correctMarkMatch) {
      current.options.push({ text: correctMarkMatch[1].trim(), isCorrect: true });
      continue;
    }

    const wrongMarkMatch = line.match(/^(?:-|\[ \])\s+(.+)$/);
    if (current && wrongMarkMatch) {
      current.options.push({ text: wrongMarkMatch[1].trim(), isCorrect: false });
      continue;
    }

    const letterOptMatch = line.match(/^([а-еА-Еa-fA-F])[\.\)]\s+(.+)$/);
    if (current && letterOptMatch) {
      let optText = letterOptMatch[2].trim();
      let isCorrect = false;
      if (optText.startsWith('*') || optText.startsWith('+')) {
        isCorrect = true;
        optText = optText.slice(1).trim();
      } else if (optText.endsWith('*') || optText.endsWith('(+)')) {
        isCorrect = true;
        optText = optText.replace(/(?:\*|\(\+\))$/, '').trim();
      }
      current.options.push({ text: optText, isCorrect });
      continue;
    }

    // Question header: "1. Text", "1) Text", "Вопрос 1: Text", "? Text"
    const qMatch = line.match(/^(?:вопрос\s*\d*\s*[:\.\)]|\d+[\.\)]|\?)\s*(.+)$/i);
    if (qMatch) {
      finalizeCurrent();
      current = {
        text: qMatch[1].trim(),
        options: [],
        answerTokens: [],
      };
      continue;
    }

    // Continuation line of question text if no options yet
    if (current && current.options.length === 0) {
      current.text += ' ' + line;
    }
  }

  finalizeCurrent();

  return { title, description, questions };
}

function parseTestJson(rawText, fallbackTitle) {
  const data = JSON.parse(rawText);
  if (!data || !Array.isArray(data.questions)) {
    throw new Error('Неверный формат JSON (ожидается массив questions)');
  }
  return {
    title: (data.title && String(data.title).trim()) || fallbackTitle,
    description: (data.description && String(data.description).trim()) || '',
    questions: data.questions.map((q) => {
      const opts = (q.options || []).map((o, idx) => ({
        id: o.id || String.fromCharCode(97 + idx),
        text: String(o.text || '').trim(),
        isCorrect: Boolean(o.isCorrect),
      }));
      const correctCount = opts.filter((o) => o.isCorrect).length;
      return {
        text: String(q.text || '').trim(),
        type: q.type === 'multiple' || correctCount > 1 ? 'multiple' : 'single',
        time_limit: Number(q.time_limit) || 30,
        points: Number(q.points) || (correctCount > 1 ? 150 : 100),
        options: opts,
      };
    }),
  };
}

export function importTestsFromFolder(db, folderPath = getTestsFolderPath()) {
  fs.mkdirSync(folderPath, { recursive: true });

  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const imported = [];
  const skipped = [];
  const errors = [];

  const checkStmt = db.prepare('SELECT id FROM tests WHERE source_file = ?');
  const insertTest = db.prepare(
    'INSERT INTO tests (id, title, description, source_file, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertQuestion = db.prepare(
    'INSERT INTO questions (id, test_id, order_index, text, type, options_json, time_limit, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fileName = entry.name;
    if (fileName.startsWith('~$')) continue; // Word temp file

    const ext = path.extname(fileName).toLowerCase();
    if (!['.txt', '.md', '.json', '.docx'].includes(ext)) continue;

    if (checkStmt.get(fileName)) {
      skipped.push(fileName);
      continue;
    }

    const fullPath = path.join(folderPath, fileName);
    const baseName = path.basename(fileName, ext).replace(/[_-]+/g, ' ').trim();

    try {
      let parsed;
      if (ext === '.json') {
        parsed = parseTestJson(fs.readFileSync(fullPath, 'utf8'), baseName);
      } else if (ext === '.docx') {
        const text = extractTextFromDocx(fullPath);
        parsed = parseTestText(text, baseName);
      } else {
        const text = fs.readFileSync(fullPath, 'utf8');
        parsed = parseTestText(text, baseName);
      }

      if (!parsed.questions || parsed.questions.length === 0) {
        errors.push({ file: fileName, error: 'Не найдено ни одного корректного вопроса с отмеченным ответом' });
        continue;
      }

      const now = new Date().toISOString();
      const testId = crypto.randomUUID();

      db.exec('BEGIN');
      try {
        insertTest.run(testId, parsed.title, parsed.description || '', fileName, now, now);
        parsed.questions.forEach((q, idx) => {
          insertQuestion.run(
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
        db.exec('COMMIT');
        imported.push({ file: fileName, title: parsed.title, questionCount: parsed.questions.length });
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    } catch (err) {
      errors.push({ file: fileName, error: err.message });
    }
  }

  return { folderPath, imported, skipped, errors };
}
