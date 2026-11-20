import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { GraduationCap, PlusCircle, QrCode } from 'lucide-react';
import JoinPage from './pages/JoinPage.jsx';
import TeacherDashboard from './pages/TeacherDashboard.jsx';
import TestBuilder from './pages/TestBuilder.jsx';
import HostScreen from './pages/HostScreen.jsx';
import PlayScreen from './pages/PlayScreen.jsx';

export default function App() {
  const location = useLocation();
  const isStudentPlay = location.pathname.startsWith('/play/');

  return (
    <div>
      {!isStudentPlay && (
        <header className="app-header">
          <Link to="/" className="brand">
            <GraduationCap size={26} />
            <span>Тесты Алтын Каппасовны</span>
          </Link>
          <nav className="nav-links">
            <Link to="/join" className="btn btn-secondary btn-sm">
              <QrCode size={16} />
              Вход ученика
            </Link>
            <Link to="/teacher" className="btn btn-primary btn-sm">
              <PlusCircle size={16} />
              Учителю
            </Link>
          </nav>
        </header>
      )}

      <Routes>
        <Route path="/" element={<JoinPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="/teacher" element={<TeacherDashboard />} />
        <Route path="/builder" element={<TestBuilder />} />
        <Route path="/builder/:id" element={<TestBuilder />} />
        <Route path="/host/:sessionId" element={<HostScreen />} />
        <Route path="/play/:sessionId" element={<PlayScreen />} />
      </Routes>
    </div>
  );
}
