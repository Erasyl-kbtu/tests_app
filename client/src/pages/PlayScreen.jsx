import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Clock, CheckCircle2, XCircle, Trophy, Send } from 'lucide-react';
import { createSocket } from '../api.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function PlayScreen() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [socket, setSocket] = useState(null);
  const [state, setState] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [selfPacedIdx, setSelfPacedIdx] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState('');

  const token = sessionStorage.getItem(`quiz_token_${sessionId}`);
  const code = sessionStorage.getItem(`quiz_code_${sessionId}`);
  const savedName = sessionStorage.getItem(`quiz_name_${sessionId}`);

  useEffect(() => {
    if (!token || !code) {
      navigate('/join');
      return;
    }

    const s = createSocket();
    setSocket(s);

    s.on('connect', () => {
      s.emit('student:join', { code, name: savedName || 'Ученик', token });
    });

    s.on('student:state', (nextState) => {
      setState(nextState);
    });

    s.on('student:error', ({ message }) => {
      setError(message);
    });

    return () => {
      s.disconnect();
    };
  }, [sessionId, token, code, savedName, navigate]);

  // Reset selected options when question changes in live mode
  const liveQuestionId = state?.currentQuestion?.id;
  useEffect(() => {
    setSelectedIds([]);
  }, [liveQuestionId]);

  // Reset selected options when stepping in self-paced mode
  useEffect(() => {
    setSelectedIds([]);
  }, [selfPacedIdx]);

  // Live countdown timer
  useEffect(() => {
    if (!state) return;
    const { session, currentQuestion } = state;
    if (session.mode !== 'live' || session.status !== 'active' || session.question_phase !== 'question') {
      return;
    }
    if (!currentQuestion || !session.question_started_at) return;

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - session.question_started_at) / 1000);
      setSecondsLeft(Math.max(0, currentQuestion.time_limit - elapsed));
    };
    updateTimer();
    const interval = setInterval(updateTimer, 250);
    return () => clearInterval(interval);
  }, [state]);

  function toggleOption(questionType, optId) {
    if (questionType === 'single') {
      setSelectedIds([optId]);
    } else {
      setSelectedIds((prev) =>
        prev.includes(optId) ? prev.filter((id) => id !== optId) : [...prev, optId]
      );
    }
  }

  function submitAnswer(questionId) {
    if (!socket || selectedIds.length === 0) return;
    socket.emit('student:submit_answer', {
      sessionId,
      token,
      questionId,
      selectedOptionIds: selectedIds,
    });
  }

  if (error) {
    return (
      <div className="container-narrow">
        <div className="alert alert-error">{error}</div>
        <Link to="/join" className="btn btn-primary">Вернуться ко входу</Link>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="container-narrow">
        <div className="card">Подключение к тесту...</div>
      </div>
    );
  }

  const { session, participant, currentQuestion, correctOptionIds, questions, myAnswers } = state;

  // Header bar for student
  const studentHeader = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
      <div>
        <div style={{ fontWeight: 700 }}>{participant.name}</div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{session.testTitle}</div>
      </div>
      <span className="badge badge-primary" style={{ fontSize: '0.95rem', padding: '6px 12px' }}>
        {participant.score} б.
      </span>
    </div>
  );

  // 1. LOBBY WAITING
  if (session.status === 'lobby') {
    return (
      <div className="container-narrow">
        {studentHeader}
        <div className="card" style={{ textAlign: 'center', padding: 36 }}>
          <h2 style={{ marginTop: 0 }}>Вы в комнате!</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            Ожидайте, когда учитель запустит тест на своём экране.
          </p>
          <span className="badge badge-primary" style={{ fontSize: '1rem', padding: '8px 16px' }}>
            Код комнаты: {session.code}
          </span>
        </div>
      </div>
    );
  }

  // 2. FINISHED SCREEN
  if (session.status === 'finished' || (session.mode === 'self_paced' && participant.finished)) {
    const answeredList = Object.values(myAnswers || {});
    const correctCount = answeredList.filter((a) => a.isCorrect).length;

    return (
      <div className="container-narrow">
        {studentHeader}
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <Trophy size={48} color="var(--primary)" style={{ marginBottom: 12 }} />
          <h1 style={{ margin: '0 0 8px' }}>Тест завершён!</h1>
          <p style={{ fontSize: '1.15rem', margin: '0 0 16px' }}>
            Ваш результат: <strong>{participant.score} баллов</strong>
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
            <span className="badge badge-success">
              Верных ответов: {correctCount} из {session.totalQuestions}
            </span>
            <span className="badge badge-primary">
              Место в классе: {participant.rank} из {participant.totalParticipants}
            </span>
          </div>
          <Link to="/join" className="btn btn-secondary">
            Выйти на главную
          </Link>
        </div>
      </div>
    );
  }

  // 3. LIVE MODE QUESTION
  if (session.mode === 'live' && currentQuestion) {
    const myAns = myAnswers[currentQuestion.id];
    const isReveal = session.question_phase === 'reveal';

    return (
      <div className="container-narrow">
        {studentHeader}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span className="badge badge-primary">
              Вопрос {session.current_question_index + 1} / {session.totalQuestions}
            </span>
            {!isReveal && (
              <span className="badge badge-warning">
                <Clock size={14} /> {secondsLeft} сек
              </span>
            )}
          </div>

          <h2 style={{ margin: '0 0 10px', fontSize: '1.25rem' }}>{currentQuestion.text}</h2>
          <p style={{ margin: '0 0 16px', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            {currentQuestion.type === 'multiple'
              ? 'Выберите один или несколько вариантов'
              : 'Выберите один правильный вариант'}
          </p>

          {isReveal && (
            <div className={`alert ${myAns?.isCorrect ? 'alert-info' : 'alert-error'}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {myAns?.isCorrect ? (
                <>
                  <CheckCircle2 size={20} color="var(--success)" />
                  <span>Верно! +{myAns.pointsEarned} баллов</span>
                </>
              ) : (
                <>
                  <XCircle size={20} color="var(--danger)" />
                  <span>{myAns ? 'Ответ неверный (0 б.)' : 'Время вышло'}</span>
                </>
              )}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {currentQuestion.options.map((opt, idx) => {
              const isSelected = myAns
                ? myAns.selectedOptionIds.includes(opt.id)
                : selectedIds.includes(opt.id);
              const isCorrectOpt = isReveal && correctOptionIds?.includes(opt.id);

              let cls = 'option-btn';
              if (isReveal) {
                if (isCorrectOpt) cls += ' correct';
                else if (isSelected) cls += ' wrong';
              } else if (isSelected) {
                cls += ' selected';
              }

              return (
                <button
                  key={opt.id}
                  type="button"
                  className={cls}
                  disabled={Boolean(myAns) || isReveal}
                  onClick={() => toggleOption(currentQuestion.type, opt.id)}
                >
                  <span className="option-letter">{LETTERS[idx]}</span>
                  <span>{opt.text}</span>
                </button>
              );
            })}
          </div>

          {!myAns && !isReveal && (
            <button
              type="button"
              className="btn btn-primary btn-lg"
              style={{ width: '100%', marginTop: 18 }}
              disabled={selectedIds.length === 0}
              onClick={() => submitAnswer(currentQuestion.id)}
            >
              <Send size={18} />
              Ответить
            </button>
          )}

          {myAns && !isReveal && (
            <div className="alert alert-info" style={{ marginTop: 16, marginBottom: 0, textAlign: 'center' }}>
              Ответ принят! Ожидаем остальных учеников...
            </div>
          )}
        </div>
      </div>
    );
  }

  // 4. SELF-PACED MODE
  if (session.mode === 'self_paced' && questions?.length) {
    // Automatically jump to first unanswered question if current is answered
    const firstUnanswered = questions.findIndex((q) => !myAnswers[q.id]);
    const activeIdx = firstUnanswered >= 0 ? firstUnanswered : selfPacedIdx;
    const q = questions[activeIdx];
    const pct = Math.round((Object.keys(myAnswers).length / questions.length) * 100);

    return (
      <div className="container-narrow">
        {studentHeader}
        <div className="progress-bar" style={{ marginBottom: 16 }}>
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span className="badge badge-primary">
              Вопрос {activeIdx + 1} из {questions.length}
            </span>
            <span className="badge">
              {q.type === 'multiple' ? 'Несколько вариантов' : 'Один вариант'}
            </span>
          </div>

          <h2 style={{ margin: '0 0 10px', fontSize: '1.25rem' }}>{q.text}</h2>
          <p style={{ margin: '0 0 16px', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            {q.type === 'multiple'
              ? 'Отметьте все правильные ответы и нажмите «Ответить»'
              : 'Выберите один вариант и нажмите «Ответить»'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {q.options.map((opt, idx) => {
              const isSelected = selectedIds.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`option-btn ${isSelected ? 'selected' : ''}`}
                  onClick={() => toggleOption(q.type, opt.id)}
                >
                  <span className="option-letter">{LETTERS[idx]}</span>
                  <span>{opt.text}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="btn btn-primary btn-lg"
            style={{ width: '100%', marginTop: 18 }}
            disabled={selectedIds.length === 0}
            onClick={() => {
              submitAnswer(q.id);
              setSelectedIds([]);
              setSelfPacedIdx(activeIdx + 1);
            }}
          >
            <Send size={18} />
            Ответить и продолжить
          </button>
        </div>
      </div>
    );
  }

  return null;
}
