import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  Play,
  SkipForward,
  Eye,
  Flag,
  Download,
  Copy,
  Check,
  Users,
  Wifi,
  Clock,
  ArrowLeft,
} from 'lucide-react';
import { apiRequest, createSocket } from '../api.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function HostScreen() {
  const { sessionId } = useParams();
  const [socket, setSocket] = useState(null);
  const [hostState, setHostState] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);
  const [selectedOrigin, setSelectedOrigin] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest('/api/server-info')
      .then((info) => {
        setServerInfo(info);
        const host = window.location.hostname;
        const currentPort = window.location.port || info.port;
        if (host === 'localhost' || host === '127.0.0.1') {
          const ip = info.defaultAddress || 'localhost';
          setSelectedOrigin(`http://${ip}:${currentPort}`);
        } else {
          setSelectedOrigin(window.location.origin);
        }
      })
      .catch(() => {
        setSelectedOrigin(window.location.origin);
      });
  }, []);

  useEffect(() => {
    const s = createSocket();
    setSocket(s);

    s.on('connect', () => {
      s.emit('host:join', { sessionId });
    });

    s.on('host:state', (state) => {
      setHostState(state);
    });

    s.on('error_msg', ({ message }) => {
      setError(message);
    });

    return () => {
      s.disconnect();
    };
  }, [sessionId]);

  const joinUrl = hostState && selectedOrigin
    ? `${selectedOrigin}/join/${hostState.session.code}`
    : '';

  useEffect(() => {
    if (!joinUrl) return;
    QRCode.toDataURL(joinUrl, { width: 260, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => {});
  }, [joinUrl]);

  // Countdown timer for live mode
  useEffect(() => {
    if (!hostState) return;
    const { session, test } = hostState;
    if (session.mode !== 'live' || session.status !== 'active' || session.question_phase !== 'question') {
      return;
    }
    const q = test.questions[session.current_question_index];
    if (!q || !session.question_started_at) return;

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - session.question_started_at) / 1000);
      setSecondsLeft(Math.max(0, q.time_limit - elapsed));
    };
    updateTimer();
    const interval = setInterval(updateTimer, 250);
    return () => clearInterval(interval);
  }, [hostState]);

  function handleCopy() {
    if (!joinUrl) return;
    navigator.clipboard?.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (error) {
    return (
      <div className="container">
        <div className="alert alert-error">{error}</div>
        <Link to="/teacher" className="btn btn-secondary">Вернуться к тестам</Link>
      </div>
    );
  }

  if (!hostState) {
    return (
      <div className="container">
        <div className="card">Подключение к комнате...</div>
      </div>
    );
  }

  const { session, test, participants, currentQuestionStats, questionBreakdown } = hostState;
  const currentPort = window.location.port || serverInfo?.port || 3000;

  // Build list of available origins for the address selector
  const originOptions = [];
  if (serverInfo?.addresses?.length) {
    for (const addr of serverInfo.addresses) {
      originOptions.push({
        value: `http://${addr.address}:${currentPort}`,
        label: `${addr.label} — ${addr.address}`,
      });
    }
  }
  if (!originOptions.some((o) => o.value === window.location.origin)) {
    originOptions.push({
      value: window.location.origin,
      label: `Текущий адрес (${window.location.host})`,
    });
  }

  // 1. LOBBY VIEW
  if (session.status === 'lobby') {
    return (
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <div>
            <span className="badge badge-primary" style={{ marginBottom: 6 }}>
              {session.mode === 'live' ? 'Живой урок (Live)' : 'Самостоятельный темп'}
            </span>
            <h1 style={{ margin: 0 }}>{test.title}</h1>
          </div>
          <Link to="/teacher" className="btn btn-secondary btn-sm">
            <ArrowLeft size={16} />
            К тестам
          </Link>
        </div>

        <div className="lobby-grid">
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Код комнаты
            </div>
            <div className="room-code-big" style={{ margin: '6px 0 16px' }}>
              {session.code}
            </div>

            {qrDataUrl && (
              <div className="qr-box">
                <img src={qrDataUrl} alt="QR-код для входа" width={230} height={230} />
              </div>
            )}

            <div style={{ marginTop: 14, textAlign: 'left' }}>
              <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                <Wifi size={15} />
                Сетевой адрес для QR-кода:
              </label>
              <select
                className="select"
                value={selectedOrigin}
                onChange={(e) => setSelectedOrigin(e.target.value)}
                style={{ fontSize: '0.88rem' }}
              >
                {originOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="input"
                readOnly
                value={joinUrl}
                style={{ fontSize: '0.82rem', background: 'var(--surface-muted)' }}
              />
              <button className="btn btn-secondary btn-sm" onClick={handleCopy} title="Копировать ссылку">
                {copied ? <Check size={16} color="var(--success)" /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Users size={24} color="var(--primary)" />
                <h2 style={{ margin: 0 }}>Ученики в классе ({participants.length})</h2>
              </div>
              <button
                className="btn btn-success btn-lg"
                onClick={() => socket?.emit('host:start', { sessionId })}
                disabled={participants.length === 0}
              >
                <Play size={20} />
                Начать тест
              </button>
            </div>

            {participants.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', marginTop: 24 }}>
                Попросите учеников навести камеру телефона на QR-код или открыть ссылку и ввести код{' '}
                <strong>{session.code}</strong>.
              </p>
            ) : (
              <div className="student-chips">
                {participants.map((p) => (
                  <span key={p.id} className="student-chip">
                    {p.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2. LIVE MODE ACTIVE
  if (session.mode === 'live' && session.status === 'active') {
    const qIndex = session.current_question_index;
    const question = test.questions[qIndex];
    const isReveal = session.question_phase === 'reveal';
    const isLast = qIndex >= test.questions.length - 1;

    return (
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="badge badge-primary">
              Вопрос {qIndex + 1} из {test.questions.length}
            </span>
            <span className="badge">Код: {session.code}</span>
            <span className="badge">
              {question.type === 'multiple' ? 'Несколько правильных' : 'Один правильный'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {!isReveal && (
              <span className="badge badge-warning" style={{ fontSize: '1rem', padding: '6px 14px' }}>
                <Clock size={16} />
                {secondsLeft} сек
              </span>
            )}
            <span className="badge badge-success" style={{ fontSize: '0.95rem', padding: '6px 14px' }}>
              Ответили: {currentQuestionStats.answeredCount} / {participants.length}
            </span>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <h1 style={{ margin: '0 0 24px', fontSize: '1.8rem', lineHeight: 1.3 }}>
            {question.text}
          </h1>

          <div className="options-grid">
            {question.options.map((opt, idx) => {
              const votes = currentQuestionStats.optionCounts[opt.id] || 0;
              const cls = isReveal
                ? opt.isCorrect
                  ? 'option-btn correct'
                  : 'option-btn'
                : 'option-btn';

              return (
                <div key={opt.id} className={cls} style={{ cursor: 'default', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="option-letter">{LETTERS[idx]}</span>
                    <span>{opt.text}</span>
                  </div>
                  {isReveal && (
                    <span className="badge" style={{ fontSize: '0.9rem' }}>
                      {votes} отв.
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
            {!isReveal ? (
              <button
                className="btn btn-primary btn-lg"
                onClick={() => socket?.emit('host:reveal', { sessionId })}
              >
                <Eye size={20} />
                Показать правильный ответ
              </button>
            ) : (
              <button
                className="btn btn-success btn-lg"
                onClick={() => socket?.emit('host:next', { sessionId })}
              >
                <SkipForward size={20} />
                {isLast ? 'Завершить и показать итоги' : 'Следующий вопрос'}
              </button>
            )}
          </div>
        </div>

        {isReveal && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Текущий рейтинг (Топ-5)</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ученик</th>
                  <th>Баллы</th>
                </tr>
              </thead>
              <tbody>
                {participants.slice(0, 5).map((p, idx) => (
                  <tr key={p.id}>
                    <td><strong>{idx + 1}</strong></td>
                    <td>{p.name}</td>
                    <td><strong>{p.score}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // 3. SELF-PACED MODE ACTIVE
  if (session.mode === 'self_paced' && session.status === 'active') {
    const totalQ = test.questions.length;
    return (
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <div>
            <span className="badge badge-primary">Самостоятельный темп · Код {session.code}</span>
            <h1 style={{ margin: '6px 0 0' }}>{test.title}</h1>
          </div>
          <button
            className="btn btn-danger btn-lg"
            onClick={() => socket?.emit('host:finish', { sessionId })}
          >
            <Flag size={18} />
            Завершить тест для всех
          </button>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Прогресс класса ({participants.length} уч.)</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Ученик</th>
                <th>Прогресс</th>
                <th>Статус</th>
                <th>Баллы</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => {
                const pct = totalQ > 0 ? Math.round((p.answeredCount / totalQ) * 100) : 0;
                return (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong></td>
                    <td style={{ minWidth: 180 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="progress-bar" style={{ flex: 1 }}>
                          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                          {p.answeredCount}/{totalQ}
                        </span>
                      </div>
                    </td>
                    <td>
                      {p.finished ? (
                        <span className="badge badge-success">Завершил</span>
                      ) : (
                        <span className="badge badge-warning">Проходит</span>
                      )}
                    </td>
                    <td><strong>{p.score}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 4. FINISHED / RESULTS VIEW
  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <span className="badge badge-success">Тест завершён</span>
          <h1 style={{ margin: '6px 0 0' }}>Итоги: {test.title}</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a
            href={`/api/sessions/${sessionId}/export.csv`}
            className="btn btn-primary"
          >
            <Download size={18} />
            Скачать CSV (Excel)
          </a>
          <Link to="/teacher" className="btn btn-secondary">
            К списку тестов
          </Link>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Результаты учеников</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Место</th>
                <th>Имя</th>
                <th>Ответов</th>
                <th>Баллы</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p, idx) => (
                <tr key={p.id}>
                  <td><strong>{idx + 1}</strong></td>
                  <td>{p.name}</td>
                  <td>{p.answeredCount} / {test.questions.length}</td>
                  <td><strong>{p.score}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Статистика по вопросам</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {questionBreakdown.map((qb) => {
              const pct = qb.totalAnswers > 0
                ? Math.round((qb.correctCount / qb.totalAnswers) * 100)
                : 0;
              return (
                <div key={qb.questionId}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.94rem' }}>
                      {qb.index + 1}. {qb.text}
                    </span>
                    <span className="badge badge-primary" style={{ flexShrink: 0 }}>
                      {pct}% верно
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
