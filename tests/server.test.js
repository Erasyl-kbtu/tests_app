import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioc } from '../client/node_modules/socket.io-client/build/esm/index.js';
import { createApp } from '../server/index.js';
import { evaluateAnswer } from '../server/socket.js';
import { getLocalAddresses } from '../server/network.js';
import { parseTestText, importTestsFromFolder } from '../server/importer.js';
import { parseGithubRepoUrl } from '../server/sync.js';
import { createDatabase } from '../server/db.js';

function startTestServer() {
  const { server, io, db } = createApp({ dbPath: ':memory:', seedDemo: true, port: 0 });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((res) => {
            io.close();
            server.close(() => {
              db.close();
              res();
            });
          }),
      });
    });
  });
}

test('evaluateAnswer handles single and multiple choice correctly', () => {
  const singleQ = {
    points: 100,
    options: [
      { id: 'a', text: '1', isCorrect: false },
      { id: 'b', text: '2', isCorrect: true },
    ],
  };
  assert.deepEqual(evaluateAnswer(singleQ, ['b']), {
    selectedIds: ['b'],
    isCorrect: true,
    pointsEarned: 100,
  });
  assert.deepEqual(evaluateAnswer(singleQ, ['a']), {
    selectedIds: ['a'],
    isCorrect: false,
    pointsEarned: 0,
  });

  const multiQ = {
    points: 150,
    options: [
      { id: 'a', text: '1', isCorrect: true },
      { id: 'b', text: '2', isCorrect: true },
      { id: 'c', text: '3', isCorrect: false },
    ],
  };
  assert.equal(evaluateAnswer(multiQ, ['a', 'b']).isCorrect, true);
  assert.equal(evaluateAnswer(multiQ, ['a', 'b']).pointsEarned, 150);
  // Partial selection should be incorrect
  assert.equal(evaluateAnswer(multiQ, ['a']).isCorrect, false);
  // Extra wrong option should be incorrect
  assert.equal(evaluateAnswer(multiQ, ['a', 'b', 'c']).isCorrect, false);
});

test('getLocalAddresses returns array of IPv4 candidates', () => {
  const addrs = getLocalAddresses();
  assert.ok(Array.isArray(addrs));
  for (const a of addrs) {
    assert.ok(typeof a.address === 'string');
    assert.ok(typeof a.label === 'string');
  }
});

test('REST API: CRUD tests, server-info, session creation and CSV export', async () => {
  const srv = await startTestServer();
  try {
    // 1. Demo test seeded
    const listRes = await fetch(`${srv.baseUrl}/api/tests`);
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.equal(list.length, 1);

    // 2. Server info
    const infoRes = await fetch(`${srv.baseUrl}/api/server-info`);
    assert.equal(infoRes.status, 200);
    const info = await infoRes.json();
    assert.ok(info.port > 0);
    assert.ok(Array.isArray(info.addresses));

    // 3. Create new test
    const createRes = await fetch(`${srv.baseUrl}/api/tests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Фотосинтез',
        description: 'Тест для 6 класса',
        questions: [
          {
            text: 'Где происходит фотосинтез?',
            type: 'single',
            time_limit: 20,
            points: 100,
            options: [
              { id: 'a', text: 'Хлоропласты', isCorrect: true },
              { id: 'b', text: 'Митохондрии', isCorrect: false },
            ],
          },
          {
            text: 'Что необходимо для фотосинтеза?',
            type: 'multiple',
            time_limit: 30,
            points: 150,
            options: [
              { id: 'a', text: 'Свет', isCorrect: true },
              { id: 'b', text: 'Углекислый газ', isCorrect: true },
              { id: 'c', text: 'Азот', isCorrect: false },
            ],
          },
        ],
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.title, 'Фотосинтез');
    assert.equal(created.questions.length, 2);

    // 4. Create session
    const sessRes = await fetch(`${srv.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testId: created.id, mode: 'live' }),
    });
    assert.equal(sessRes.status, 201);
    const session = await sessRes.json();
    assert.match(session.code, /^\d{6}$/);

    // 5. Lookup by code
    const lookupRes = await fetch(`${srv.baseUrl}/api/sessions/by-code/${session.code}`);
    assert.equal(lookupRes.status, 200);
    const lookup = await lookupRes.json();
    assert.equal(lookup.id, session.id);

    // 6. Export CSV
    const csvRes = await fetch(`${srv.baseUrl}/api/sessions/${session.id}/export.csv`);
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.ok(csvText.includes('ФИО ученика;Баллы'));
  } finally {
    await srv.close();
  }
});

test('Socket.IO: Live classroom flow (join, start, answer, auto-reveal, next, finish)', async () => {
  const srv = await startTestServer();
  const hostSocket = ioc(srv.baseUrl, { transports: ['websocket'] });
  const studentSocket = ioc(srv.baseUrl, { transports: ['websocket'] });

  try {
    const tests = await (await fetch(`${srv.baseUrl}/api/tests`)).json();
    const testId = tests[0].id;
    const session = await (
      await fetch(`${srv.baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testId, mode: 'live' }),
      })
    ).json();

    // Host joins
    await new Promise((resolve) => {
      hostSocket.once('host:state', resolve);
      hostSocket.emit('host:join', { sessionId: session.id });
    });

    // Student joins
    const joinedInfo = await new Promise((resolve) => {
      studentSocket.once('student:joined', resolve);
      studentSocket.emit('student:join', { code: session.code, name: 'Алия' });
    });

    // Host starts live quiz
    const activeState = await new Promise((resolve) => {
      studentSocket.once('student:state', (st) => {
        if (st.session.status === 'active') resolve(st);
      });
      hostSocket.emit('host:start', { sessionId: session.id });
    });
    assert.equal(activeState.currentQuestion.text.includes('АТФ'), true);

    // Student submits correct answer (option 'b' = Митохондрия)
    // Since there is only 1 student, answering should auto-reveal!
    const revealedState = await new Promise((resolve) => {
      studentSocket.once('student:state', (st) => {
        if (st.session.question_phase === 'reveal') resolve(st);
      });
      studentSocket.emit('student:submit_answer', {
        sessionId: session.id,
        token: joinedInfo.token,
        questionId: activeState.currentQuestion.id,
        selectedOptionIds: ['b'],
      });
    });

    assert.equal(revealedState.participant.score, 100);
    assert.deepEqual(revealedState.correctOptionIds, ['b']);

    // Host finishes
    const finishedState = await new Promise((resolve) => {
      studentSocket.once('student:state', (st) => {
        if (st.session.status === 'finished') resolve(st);
      });
      hostSocket.emit('host:finish', { sessionId: session.id });
    });
    assert.equal(finishedState.session.status, 'finished');
  } finally {
    hostSocket.disconnect();
    studentSocket.disconnect();
    await srv.close();
  }
});

test('importer: parses txt formats and imports new files without duplicates', () => {
  const parsed = parseTestText(`
Название: Тест из текста
1. Столица Казахстана?
- Алматы
* Астана

2. Выберите органеллы:
А) Ядро
Б) Рибосома
В) Вода
Ответ: А, Б
  `);
  assert.equal(parsed.title, 'Тест из текста');
  assert.equal(parsed.questions.length, 2);
  assert.equal(parsed.questions[0].type, 'single');
  assert.equal(parsed.questions[1].type, 'multiple');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-import-'));
  const db = createDatabase(':memory:', { seedDemo: false });
  try {
    fs.writeFileSync(path.join(tmpDir, 'sample.txt'), `
1. 2 + 2 = ?
* 4
- 5
    `, 'utf8');

    const first = importTestsFromFolder(db, tmpDir);
    assert.equal(first.imported.length, 1);
    assert.equal(first.errors.length, 0);

    // Second run should skip already imported file
    const second = importTestsFromFolder(db, tmpDir);
    assert.equal(second.imported.length, 0);
    assert.equal(second.skipped.length, 1);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('parseGithubRepoUrl parses repo URLs and owner/repo shorthand', () => {
  assert.deepEqual(parseGithubRepoUrl('https://github.com/user/biology-tests'), {
    owner: 'user',
    repo: 'biology-tests',
    subPath: '',
  });
  assert.deepEqual(parseGithubRepoUrl('https://github.com/user/biology-tests/tree/main/тесты'), {
    owner: 'user',
    repo: 'biology-tests',
    subPath: 'тесты',
  });
  assert.deepEqual(parseGithubRepoUrl('user/biology-tests'), {
    owner: 'user',
    repo: 'biology-tests',
    subPath: '',
  });
  assert.equal(parseGithubRepoUrl('invalid-url'), null);
});
