import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Play,
  Plus,
  Edit3,
  Trash2,
  Users,
  Clock,
  FolderDown,
  Upload,
  RefreshCw,
} from 'lucide-react';
import { apiRequest } from '../api.js';

export default function TeacherDashboard() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [importing, setImporting] = useState(false);
  const [launchingId, setLaunchingId] = useState(null);

  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [githubRepo, setGithubRepo] = useState('');
  const [syncing, setSyncing] = useState(false);

  async function loadTests() {
    try {
      setLoading(true);
      const data = await apiRequest('/api/tests');
      setTests(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTests();
    apiRequest('/api/tests/sync-config')
      .then((cfg) => {
        if (cfg.githubRepo) setGithubRepo(cfg.githubRepo);
      })
      .catch(() => {});
  }, []);

  async function handleLaunch(testId, mode) {
    try {
      setLaunchingId(`${testId}:${mode}`);
      const session = await apiRequest('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ testId, mode }),
      });
      navigate(`/host/${session.id}`);
    } catch (err) {
      setError(err.message);
      setLaunchingId(null);
    }
  }

  async function handleImportFolder() {
    setError('');
    setStatusMsg('');
    setImporting(true);
    try {
      const res = await apiRequest('/api/tests/import-folder', { method: 'POST' });
      const parts = [];
      if (res.imported?.length > 0) {
        parts.push(`Загружено новых тестов: ${res.imported.length}`);
        await loadTests();
      } else {
        parts.push('Новых файлов в папке «тесты» не найдено');
      }
      if (res.errors?.length > 0) {
        parts.push(`Ошибки: ${res.errors.map((e) => `${e.file} (${e.error})`).join('; ')}`);
      }
      setStatusMsg(parts.join('. '));
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError('');
    setStatusMsg('');
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const contentBase64 = btoa(binary);

      const res = await apiRequest('/api/tests/upload', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, contentBase64 }),
      });

      if (res.imported?.length > 0) {
        setStatusMsg(`Тест из файла «${file.name}» добавлен!`);
        await loadTests();
      } else if (res.errors?.length > 0) {
        setError(res.errors.map((err) => `${err.file}: ${err.error}`).join('; '));
      } else {
        setStatusMsg('Файл обработан');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleSyncGithub(e) {
    e.preventDefault();
    setError('');
    setStatusMsg('');
    setSyncing(true);
    try {
      const res = await apiRequest('/api/tests/sync-github', {
        method: 'POST',
        body: JSON.stringify({ githubRepo }),
      });
      if (!githubRepo.trim()) {
        setStatusMsg('Автосинхронизация с GitHub отключена');
      } else if (res.imported?.length > 0) {
        setStatusMsg(`Синхронизация завершена! Загружено новых тестов: ${res.imported.length}`);
        await loadTests();
      } else {
        setStatusMsg('Синхронизация завершена: все тесты уже актуальны');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete(testId, title) {
    if (!window.confirm(`Удалить тест «${title}»?`)) return;
    try {
      await apiRequest(`/api/tests/${testId}`, { method: 'DELETE' });
      setTests((prev) => prev.filter((t) => t.id !== testId));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0 }}>Мои тесты</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)' }}>
            Создавайте тесты и запускайте их в классе с подключением по QR-коду
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.docx,.md,.json"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
          <button
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            title="Загрузить тест с компьютера (.txt, .docx, .md, .json)"
          >
            <Upload size={18} />
            Загрузить файл
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleImportFolder}
            disabled={importing}
            title="Сканировать папку «тесты» рядом с программой"
          >
            <FolderDown size={18} />
            Из папки «тесты»
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setShowSyncPanel((v) => !v)}
            title="Синхронизация тестов между ноутбуками через GitHub"
          >
            <RefreshCw size={18} />
            Синхронизация
          </button>
          <Link to="/builder" className="btn btn-primary">
            <Plus size={18} />
            Создать тест
          </Link>
        </div>
      </div>

      {showSyncPanel && (
        <div className="card" style={{ marginBottom: 20, background: 'var(--surface-muted)' }}>
          <h3 style={{ margin: '0 0 8px' }}>Синхронизация тестов с другого устройства (GitHub)</h3>
          <p style={{ margin: '0 0 12px', fontSize: '0.92rem', color: 'var(--text-muted)' }}>
            Укажите ссылку на ваш публичный репозиторий GitHub с файлами тестов (`.txt`, `.docx`, `.json`).
            Новые тесты будут автоматически скачиваться на это устройство при запуске `.exe` без пересборки!
          </p>
          <form onSubmit={handleSyncGithub} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 240 }}
              type="text"
              placeholder="Например: https://github.com/username/biology-tests"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={syncing}>
              <RefreshCw size={16} />
              {syncing ? 'Синхронизация...' : 'Сохранить и обновить'}
            </button>
          </form>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {statusMsg && <div className="alert alert-info">{statusMsg}</div>}

      {loading ? (
        <div className="card">Загрузка тестов...</div>
      ) : tests.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <p style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>
            У вас пока нет тестов. Создайте первый тест!
          </p>
          <Link to="/builder" className="btn btn-primary">
            <Plus size={18} />
            Создать тест
          </Link>
        </div>
      ) : (
        <div className="grid-2">
          {tests.map((test) => (
            <div key={test.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{test.title}</h2>
                  <span className="badge badge-primary">{test.question_count} вопр.</span>
                </div>
                {test.description && (
                  <p style={{ color: 'var(--text-muted)', margin: '8px 0 0', fontSize: '0.94rem' }}>
                    {test.description}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    disabled={launchingId !== null}
                    onClick={() => handleLaunch(test.id, 'live')}
                    title="Учитель переключает вопросы на общем экране"
                  >
                    <Play size={16} />
                    Живой урок (Live)
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1 }}
                    disabled={launchingId !== null}
                    onClick={() => handleLaunch(test.id, 'self_paced')}
                    title="Ученики проходят вопросы в своём темпе"
                  >
                    <Clock size={16} />
                    Свой темп
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                  <Link to={`/builder/${test.id}`} className="btn btn-secondary btn-sm">
                    <Edit3 size={15} />
                    Редактировать
                  </Link>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDelete(test.id, test.title)}
                  >
                    <Trash2 size={15} />
                    Удалить
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="alert alert-info" style={{ marginTop: 28, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Users size={20} style={{ flexShrink: 0 }} />
        <span>
          <strong>Живой урок (Live)</strong> — вопросы открываются синхронно у всех на экранах.{' '}
          <strong>Свой темп</strong> — каждый ученик отвечает самостоятельно, а вы видите прогресс класса.
        </span>
      </div>
    </div>
  );
}
