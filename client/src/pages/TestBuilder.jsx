import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Plus, Trash2, Save, ArrowLeft, CheckSquare, CircleDot } from 'lucide-react';
import { apiRequest } from '../api.js';

function createEmptyQuestion() {
  return {
    text: '',
    type: 'single',
    time_limit: 30,
    points: 100,
    options: [
      { id: 'a', text: '', isCorrect: true },
      { id: 'b', text: '', isCorrect: false },
      { id: 'c', text: '', isCorrect: false },
      { id: 'd', text: '', isCorrect: false },
    ],
  };
}

export default function TestBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditing = Boolean(id);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState([createEmptyQuestion()]);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    apiRequest(`/api/tests/${id}`)
      .then((test) => {
        setTitle(test.title);
        setDescription(test.description || '');
        setQuestions(
          test.questions.map((q) => ({
            id: q.id,
            text: q.text,
            type: q.type,
            time_limit: q.time_limit,
            points: q.points,
            options: q.options,
          }))
        );
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  function updateQuestion(qIdx, patch) {
    setQuestions((prev) =>
      prev.map((q, idx) => (idx === qIdx ? { ...q, ...patch } : q))
    );
  }

  function handleTypeChange(qIdx, newType) {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qIdx) return q;
        let nextOptions = q.options;
        if (newType === 'single') {
          const firstCorrect = q.options.findIndex((o) => o.isCorrect);
          const keepIdx = firstCorrect >= 0 ? firstCorrect : 0;
          nextOptions = q.options.map((o, i) => ({ ...o, isCorrect: i === keepIdx }));
        }
        return { ...q, type: newType, options: nextOptions };
      })
    );
  }

  function updateOptionText(qIdx, optIdx, text) {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qIdx) return q;
        return {
          ...q,
          options: q.options.map((o, i) => (i === optIdx ? { ...o, text } : o)),
        };
      })
    );
  }

  function toggleOptionCorrect(qIdx, optIdx) {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qIdx) return q;
        if (q.type === 'single') {
          return {
            ...q,
            options: q.options.map((o, i) => ({ ...o, isCorrect: i === optIdx })),
          };
        }
        return {
          ...q,
          options: q.options.map((o, i) =>
            i === optIdx ? { ...o, isCorrect: !o.isCorrect } : o
          ),
        };
      })
    );
  }

  function addOption(qIdx) {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qIdx || q.options.length >= 6) return q;
        const nextId = String.fromCharCode(97 + q.options.length);
        return {
          ...q,
          options: [...q.options, { id: nextId, text: '', isCorrect: false }],
        };
      })
    );
  }

  function removeOption(qIdx, optIdx) {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qIdx || q.options.length <= 2) return q;
        const filtered = q.options.filter((_, i) => i !== optIdx);
        return { ...q, options: filtered };
      })
    );
  }

  function addQuestion() {
    setQuestions((prev) => [...prev, createEmptyQuestion()]);
  }

  function removeQuestion(qIdx) {
    if (questions.length <= 1) return;
    setQuestions((prev) => prev.filter((_, i) => i !== qIdx));
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = { title, description, questions };
      if (isEditing) {
        await apiRequest(`/api/tests/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/api/tests', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      navigate('/teacher');
    } catch (err) {
      setError(err.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="container">
        <div className="card">Загрузка конструктора...</div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Link to="/teacher" className="btn btn-secondary btn-sm">
          <ArrowLeft size={16} />
          Назад
        </Link>
        <h1 style={{ margin: 0 }}>
          {isEditing ? 'Редактирование теста' : 'Новый тест'}
        </h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSave}>
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="field">
            <label className="label">Название теста</label>
            <input
              className="input"
              type="text"
              placeholder="Например: Биология 8 класс — Клеточное строение"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Описание (необязательно)</label>
            <input
              className="input"
              type="text"
              placeholder="Краткая тема или инструкция для класса"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {questions.map((q, qIdx) => (
          <div key={qIdx} className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
              <span className="badge badge-primary" style={{ fontSize: '0.92rem' }}>
                Вопрос №{qIdx + 1}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${q.type === 'single' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleTypeChange(qIdx, 'single')}
                >
                  <CircleDot size={15} />
                  Один правильный
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${q.type === 'multiple' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleTypeChange(qIdx, 'multiple')}
                >
                  <CheckSquare size={15} />
                  Несколько правильных
                </button>
                {questions.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => removeQuestion(qIdx)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>

            <div className="field">
              <textarea
                className="textarea"
                rows={2}
                placeholder="Введите текст вопроса..."
                value={q.text}
                onChange={(e) => updateQuestion(qIdx, { text: e.target.value })}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
              <div>
                <label className="label">Время (сек, для Live)</label>
                <select
                  className="select"
                  value={q.time_limit}
                  onChange={(e) => updateQuestion(qIdx, { time_limit: Number(e.target.value) })}
                >
                  <option value={15}>15 секунд</option>
                  <option value={20}>20 секунд</option>
                  <option value={30}>30 секунд</option>
                  <option value={45}>45 секунд</option>
                  <option value={60}>60 секунд</option>
                  <option value={90}>90 секунд</option>
                  <option value={120}>120 секунд</option>
                </select>
              </div>
              <div>
                <label className="label">Баллы за верный ответ</label>
                <select
                  className="select"
                  value={q.points}
                  onChange={(e) => updateQuestion(qIdx, { points: Number(e.target.value) })}
                >
                  <option value={50}>50 баллов</option>
                  <option value={100}>100 баллов</option>
                  <option value={150}>150 баллов</option>
                  <option value={200}>200 баллов</option>
                </select>
              </div>
            </div>

            <label className="label">
              Варианты ответов (отметьте {q.type === 'single' ? 'один правильный' : 'все правильные'}):
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {q.options.map((opt, optIdx) => (
                <div key={optIdx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type={q.type === 'single' ? 'radio' : 'checkbox'}
                    name={`correct_${qIdx}`}
                    checked={Boolean(opt.isCorrect)}
                    onChange={() => toggleOptionCorrect(qIdx, optIdx)}
                    style={{ width: 20, height: 20, cursor: 'pointer', accentColor: 'var(--success)' }}
                    title="Отметить как правильный ответ"
                  />
                  <input
                    className="input"
                    type="text"
                    placeholder={`Вариант ${optIdx + 1}`}
                    value={opt.text}
                    onChange={(e) => updateOptionText(qIdx, optIdx, e.target.value)}
                    style={opt.isCorrect ? { borderColor: 'var(--success)', background: '#f6fef9' } : undefined}
                  />
                  {q.options.length > 2 && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => removeOption(qIdx, optIdx)}
                      title="Удалить вариант"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            {q.options.length < 6 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 10 }}
                onClick={() => addOption(qIdx)}
              >
                <Plus size={15} />
                Добавить вариант
              </button>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
          <button type="button" className="btn btn-secondary btn-lg" onClick={addQuestion}>
            <Plus size={20} />
            Добавить вопрос
          </button>
          <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
            <Save size={20} />
            {saving ? 'Сохранение...' : 'Сохранить тест'}
          </button>
        </div>
      </form>
    </div>
  );
}
