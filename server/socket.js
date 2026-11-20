import crypto from 'node:crypto';
import { getTestWithQuestions } from './db.js';

function sanitizeQuestion(q) {
  return {
    id: q.id,
    order_index: q.order_index,
    text: q.text,
    type: q.type,
    time_limit: q.time_limit,
    points: q.points,
    options: q.options.map((o) => ({ id: o.id, text: o.text })),
  };
}

export function evaluateAnswer(question, selectedOptionIds) {
  const validIds = new Set(question.options.map((o) => o.id));
  const selectedSet = new Set(
    (Array.isArray(selectedOptionIds) ? selectedOptionIds : []).filter((id) => validIds.has(id))
  );
  const correctSet = new Set(question.options.filter((o) => o.isCorrect).map((o) => o.id));

  const isCorrect =
    selectedSet.size === correctSet.size && [...correctSet].every((id) => selectedSet.has(id));

  return {
    selectedIds: [...selectedSet],
    isCorrect,
    pointsEarned: isCorrect ? question.points : 0,
  };
}

export function registerSocketHandlers(io, db) {
  const activeTimers = new Map();

  function clearSessionTimer(sessionId) {
    const t = activeTimers.get(sessionId);
    if (t) {
      clearTimeout(t);
      activeTimers.delete(sessionId);
    }
  }

  function scheduleLiveTimer(sessionId, seconds) {
    clearSessionTimer(sessionId);
    const timer = setTimeout(() => {
      activeTimers.delete(sessionId);
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      if (session && session.status === 'active' && session.mode === 'live' && session.question_phase === 'question') {
        db.prepare("UPDATE sessions SET question_phase = 'reveal' WHERE id = ?").run(sessionId);
        broadcastAll(sessionId);
      }
    }, seconds * 1000);
    activeTimers.set(sessionId, timer);
  }

  function buildHostState(sessionId) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return null;

    const test = getTestWithQuestions(db, session.test_id);
    const participants = db
      .prepare('SELECT id, name, score, finished, joined_at FROM participants WHERE session_id = ? ORDER BY score DESC, joined_at ASC')
      .all(sessionId);

    const answers = db
      .prepare('SELECT participant_id, question_id, selected_option_ids_json, is_correct FROM answers WHERE session_id = ?')
      .all(sessionId);

    const currentQ =
      session.current_question_index >= 0 && session.current_question_index < test.questions.length
        ? test.questions[session.current_question_index]
        : null;

    const answeredCountByParticipant = new Map();
    const answeredCurrentSet = new Set();
    const optionCounts = {};
    const questionStatsMap = new Map();

    for (const q of test.questions) {
      questionStatsMap.set(q.id, { correctCount: 0, totalAnswers: 0 });
    }
    if (currentQ) {
      for (const opt of currentQ.options) {
        optionCounts[opt.id] = 0;
      }
    }

    for (const a of answers) {
      answeredCountByParticipant.set(
        a.participant_id,
        (answeredCountByParticipant.get(a.participant_id) || 0) + 1
      );
      const qStat = questionStatsMap.get(a.question_id);
      if (qStat) {
        qStat.totalAnswers++;
        if (a.is_correct) qStat.correctCount++;
      }
      if (currentQ && a.question_id === currentQ.id) {
        answeredCurrentSet.add(a.participant_id);
        const selected = JSON.parse(a.selected_option_ids_json);
        for (const optId of selected) {
          if (optionCounts[optId] !== undefined) {
            optionCounts[optId]++;
          }
        }
      }
    }

    return {
      session,
      test: {
        id: test.id,
        title: test.title,
        description: test.description,
        questions: test.questions,
      },
      participants: participants.map((p) => ({
        ...p,
        answeredCount: answeredCountByParticipant.get(p.id) || 0,
        answeredCurrent: answeredCurrentSet.has(p.id),
      })),
      currentQuestionStats: {
        answeredCount: answeredCurrentSet.size,
        optionCounts,
      },
      questionBreakdown: test.questions.map((q, idx) => ({
        questionId: q.id,
        index: idx,
        text: q.text,
        ...(questionStatsMap.get(q.id) || { correctCount: 0, totalAnswers: 0 }),
      })),
    };
  }

  function buildStudentState(sessionId, participantId) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return null;

    const test = getTestWithQuestions(db, session.test_id);
    const participant = db
      .prepare('SELECT id, name, score, finished FROM participants WHERE id = ? AND session_id = ?')
      .get(participantId, sessionId);
    if (!participant) return null;

    const myAnswers = db
      .prepare('SELECT question_id, selected_option_ids_json, is_correct, points_earned FROM answers WHERE participant_id = ?')
      .all(participantId);

    const myAnswerMap = {};
    for (const a of myAnswers) {
      myAnswerMap[a.question_id] = {
        selectedOptionIds: JSON.parse(a.selected_option_ids_json),
        isCorrect: Boolean(a.is_correct),
        pointsEarned: a.points_earned,
      };
    }

    const rankRows = db
      .prepare('SELECT id FROM participants WHERE session_id = ? ORDER BY score DESC, joined_at ASC')
      .all(sessionId);
    const rank = rankRows.findIndex((r) => r.id === participantId) + 1;

    let currentQuestion = null;
    let correctOptionIds = null;

    if (session.mode === 'live' && session.status === 'active') {
      const q = test.questions[session.current_question_index];
      if (q) {
        currentQuestion = sanitizeQuestion(q);
        if (session.question_phase === 'reveal') {
          correctOptionIds = q.options.filter((o) => o.isCorrect).map((o) => o.id);
        }
      }
    }

    return {
      session: {
        id: session.id,
        code: session.code,
        mode: session.mode,
        status: session.status,
        current_question_index: session.current_question_index,
        question_phase: session.question_phase,
        question_started_at: session.question_started_at,
        testTitle: test.title,
        totalQuestions: test.questions.length,
      },
      participant: {
        ...participant,
        rank,
        totalParticipants: rankRows.length,
      },
      currentQuestion,
      correctOptionIds,
      questions: session.mode === 'self_paced' ? test.questions.map(sanitizeQuestion) : undefined,
      myAnswers: myAnswerMap,
    };
  }

  async function broadcastAll(sessionId) {
    const hostState = buildHostState(sessionId);
    if (hostState) {
      io.to(`host:${sessionId}`).emit('host:state', hostState);
    }

    const sockets = await io.in(`session:${sessionId}`).fetchSockets();
    for (const s of sockets) {
      if (s.data.participantId) {
        const stState = buildStudentState(sessionId, s.data.participantId);
        if (stState) {
          s.emit('student:state', stState);
        }
      }
    }
  }

  io.on('connection', (socket) => {
    socket.on('host:join', ({ sessionId }) => {
      if (!sessionId) return;
      socket.join(`host:${sessionId}`);
      const state = buildHostState(sessionId);
      if (state) {
        socket.emit('host:state', state);
      } else {
        socket.emit('error_msg', { message: 'Сессия не найдена' });
      }
    });

    socket.on('host:start', async ({ sessionId }) => {
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      if (!session) return;

      const test = getTestWithQuestions(db, session.test_id);
      if (!test || test.questions.length === 0) return;

      const nowMs = Date.now();
      if (session.mode === 'live') {
        db.prepare(
          "UPDATE sessions SET status = 'active', current_question_index = 0, question_phase = 'question', question_started_at = ? WHERE id = ?"
        ).run(nowMs, sessionId);
        scheduleLiveTimer(sessionId, test.questions[0].time_limit);
      } else {
        db.prepare(
          "UPDATE sessions SET status = 'active', question_started_at = ? WHERE id = ?"
        ).run(nowMs, sessionId);
      }

      await broadcastAll(sessionId);
    });

    socket.on('host:reveal', async ({ sessionId }) => {
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      if (!session || session.mode !== 'live' || session.status !== 'active') return;
      clearSessionTimer(sessionId);
      db.prepare("UPDATE sessions SET question_phase = 'reveal' WHERE id = ?").run(sessionId);
      await broadcastAll(sessionId);
    });

    socket.on('host:next', async ({ sessionId }) => {
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      if (!session || session.mode !== 'live' || session.status !== 'active') return;

      const test = getTestWithQuestions(db, session.test_id);
      const nextIndex = session.current_question_index + 1;

      clearSessionTimer(sessionId);

      if (nextIndex >= test.questions.length) {
        db.prepare("UPDATE sessions SET status = 'finished' WHERE id = ?").run(sessionId);
      } else {
        const nowMs = Date.now();
        db.prepare(
          "UPDATE sessions SET current_question_index = ?, question_phase = 'question', question_started_at = ? WHERE id = ?"
        ).run(nextIndex, nowMs, sessionId);
        scheduleLiveTimer(sessionId, test.questions[nextIndex].time_limit);
      }

      await broadcastAll(sessionId);
    });

    socket.on('host:finish', async ({ sessionId }) => {
      clearSessionTimer(sessionId);
      db.prepare("UPDATE sessions SET status = 'finished' WHERE id = ?").run(sessionId);
      await broadcastAll(sessionId);
    });

    socket.on('student:join', async ({ code, name, token }) => {
      const cleanCode = String(code || '').trim();
      const session = db.prepare('SELECT * FROM sessions WHERE code = ?').get(cleanCode);
      if (!session) {
        return socket.emit('student:error', { message: 'Комната с таким кодом не найдена' });
      }

      let participant = null;
      if (token) {
        participant = db
          .prepare('SELECT * FROM participants WHERE session_id = ? AND token = ?')
          .get(session.id, token);
      }

      if (!participant) {
        if (session.status === 'finished') {
          return socket.emit('student:error', { message: 'Этот тест уже завершён' });
        }
        const cleanName = String(name || '').trim().slice(0, 80);
        if (!cleanName) {
          return socket.emit('student:error', { message: 'Введите ваше ФИО' });
        }

        const participantId = crypto.randomUUID();
        const newToken = token || crypto.randomUUID();
        const now = new Date().toISOString();

        db.prepare(
          'INSERT INTO participants (id, session_id, token, name, score, finished, joined_at) VALUES (?, ?, ?, ?, 0, 0, ?)'
        ).run(participantId, session.id, newToken, cleanName, now);

        participant = db.prepare('SELECT * FROM participants WHERE id = ?').get(participantId);
      }

      socket.join(`session:${session.id}`);
      socket.data.sessionId = session.id;
      socket.data.participantId = participant.id;

      socket.emit('student:joined', {
        sessionId: session.id,
        token: participant.token,
        participantId: participant.id,
      });

      const studentState = buildStudentState(session.id, participant.id);
      socket.emit('student:state', studentState);

      const hostState = buildHostState(session.id);
      if (hostState) {
        io.to(`host:${session.id}`).emit('host:state', hostState);
      }
    });

    socket.on('student:submit_answer', async ({ sessionId, token, questionId, selectedOptionIds }) => {
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      if (!session || session.status !== 'active') return;

      const participant = db
        .prepare('SELECT * FROM participants WHERE session_id = ? AND token = ?')
        .get(sessionId, token);
      if (!participant) return;

      const test = getTestWithQuestions(db, session.test_id);
      const question = test.questions.find((q) => q.id === questionId);
      if (!question) return;

      if (session.mode === 'live') {
        const currentQ = test.questions[session.current_question_index];
        if (!currentQ || currentQ.id !== question.id || session.question_phase !== 'question') {
          return;
        }
      }

      const existing = db
        .prepare('SELECT id FROM answers WHERE participant_id = ? AND question_id = ?')
        .get(participant.id, question.id);
      if (existing) return;

      const { selectedIds, isCorrect, pointsEarned } = evaluateAnswer(question, selectedOptionIds);
      const now = new Date().toISOString();

      db.exec('BEGIN');
      try {
        db.prepare(
          `INSERT INTO answers (id, session_id, participant_id, question_id, selected_option_ids_json, is_correct, points_earned, answered_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          sessionId,
          participant.id,
          question.id,
          JSON.stringify(selectedIds),
          isCorrect ? 1 : 0,
          pointsEarned,
          now
        );

        db.prepare('UPDATE participants SET score = score + ? WHERE id = ?').run(
          pointsEarned,
          participant.id
        );

        if (session.mode === 'self_paced') {
          const answeredCount = db
            .prepare('SELECT COUNT(*) AS cnt FROM answers WHERE participant_id = ?')
            .get(participant.id).cnt;
          if (answeredCount >= test.questions.length) {
            db.prepare('UPDATE participants SET finished = 1 WHERE id = ?').run(participant.id);
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      if (session.mode === 'live') {
        const totalParticipants = db
          .prepare('SELECT COUNT(*) AS cnt FROM participants WHERE session_id = ?')
          .get(sessionId).cnt;
        const answeredCurrent = db
          .prepare('SELECT COUNT(*) AS cnt FROM answers WHERE session_id = ? AND question_id = ?')
          .get(sessionId, question.id).cnt;

        if (totalParticipants > 0 && answeredCurrent >= totalParticipants) {
          clearSessionTimer(sessionId);
          db.prepare("UPDATE sessions SET question_phase = 'reveal' WHERE id = ?").run(sessionId);
        }
      }

      await broadcastAll(sessionId);
    });
  });
}
