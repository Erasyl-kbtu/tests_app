import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowRight, QrCode, UserCheck, Edit2 } from 'lucide-react';
import { apiRequest, createSocket } from '../api.js';

const STORAGE_FIO_KEY = 'quiz_student_fio';

export default function JoinPage() {
  const { code: urlCode } = useParams();
  const navigate = useNavigate();

  const savedFio = localStorage.getItem(STORAGE_FIO_KEY) || '';
  const [code, setCode] = useState(urlCode || '');
  const [name, setName] = useState(savedFio);
  const [editingFio, setEditingFio] = useState(!savedFio);
  const [roomPreview, setRoomPreview] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (urlCode) {
      setCode(urlCode);
      apiRequest(`/api/sessions/by-code/${encodeURIComponent(urlCode)}`)
        .then(setRoomPreview)
        .catch(() => setRoomPreview(null));
    }
  }, [urlCode]);

  function handleSaveFioOnly() {
    const clean = name.trim();
    if (!clean) {
      setError('Введите ваше ФИО');
      return;
    }
    setError('');
    localStorage.setItem(STORAGE_FIO_KEY, clean);
    setName(clean);
    setEditingFio(false);
  }

  async function handleJoin(e) {
    e.preventDefault();
    setError('');
    const cleanCode = code.trim();
    const cleanName = name.trim();

    if (!cleanName) {
      setEditingFio(true);
      return setError('Введите ваше ФИО');
    }
    if (!cleanCode) {
      return setError('Введите 6-значный код комнаты');
    }

    localStorage.setItem(STORAGE_FIO_KEY, cleanName);
    setLoading(true);
    try {
      const sessionInfo = await apiRequest(`/api/sessions/by-code/${encodeURIComponent(cleanCode)}`);
      if (sessionInfo.status === 'finished') {
        setLoading(false);
        return setError('Этот тест уже завершён');
      }

      const existingToken = sessionStorage.getItem(`quiz_token_${sessionInfo.id}`);
      const socket = createSocket();

      socket.on('connect', () => {
        socket.emit('student:join', {
          code: cleanCode,
          name: cleanName,
          token: existingToken || undefined,
        });
      });

      socket.on('student:joined', ({ sessionId, token }) => {
        sessionStorage.setItem(`quiz_token_${sessionId}`, token);
        sessionStorage.setItem(`quiz_code_${sessionId}`, cleanCode);
        sessionStorage.setItem(`quiz_name_${sessionId}`, cleanName);
        socket.disconnect();
        navigate(`/play/${sessionId}`);
      });

      socket.on('student:error', ({ message }) => {
        setError(message || 'Не удалось войти');
        setLoading(false);
        socket.disconnect();
      });

      socket.on('connect_error', () => {
        setError('Нет связи с сервером');
        setLoading(false);
        socket.disconnect();
      });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="container-narrow">
      <div className="card" style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <QrCode size={28} color="var(--primary)" />
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Вход ученика в тест</h1>
        </div>

        {roomPreview ? (
          <div className="alert alert-info">
            Тест: <strong>{roomPreview.testTitle}</strong> (
            {roomPreview.mode === 'live' ? 'Живой урок' : 'Самостоятельный темп'})
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
            Укажите ваше ФИО (без пароля) и введите код комнаты или отсканируйте QR-код на экране учителя.
          </p>
        )}

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleJoin}>
          {!editingFio && name.trim() ? (
            <div
              className="field"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '12px 14px',
                borderRadius: 10,
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <UserCheck size={20} color="var(--success)" />
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Ваше ФИО</div>
                  <div style={{ fontWeight: 700 }}>{name}</div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setEditingFio(true)}
              >
                <Edit2 size={14} />
                Изменить
              </button>
            </div>
          ) : (
            <div className="field">
              <label className="label" htmlFor="student-name">
                ФИО (Фамилия Имя Отчество)
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  id="student-name"
                  className="input"
                  type="text"
                  maxLength={80}
                  placeholder="Например: Серикова Алия Ерлановна"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                {!urlCode && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleSaveFioOnly}
                    title="Сохранить ФИО на этом устройстве"
                  >
                    Сохранить
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="field">
            <label className="label" htmlFor="room-code">Код комнаты</label>
            <input
              id="room-code"
              className="input"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="Например: 482910"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              style={{ fontSize: '1.25rem', letterSpacing: '0.15em', fontWeight: 700 }}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: '100%' }}
            disabled={loading}
          >
            {loading ? 'Подключение...' : 'Войти в тест'}
            <ArrowRight size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}
