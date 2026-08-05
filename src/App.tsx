import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { AtendimentoPage } from './pages/AtendimentoPage';
import { ContatosPage } from './pages/ContatosPage';
import { CampanhasPage } from './pages/CampanhasPage';
import { ConfiguracoesPage } from './pages/ConfiguracoesPage';
import { LoginPage } from './pages/LoginPage';
import { useAuth } from './auth/AuthContext';

const AuthenticatedApp: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-sm text-zinc-500">Carregando...</div>;
  }

  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Navigate to="/atendimento" replace />} />
        <Route path="atendimento" element={<AtendimentoPage />} />
        <Route path="contatos" element={<ContatosPage />} />
        <Route path="campanhas" element={<CampanhasPage />} />
        <Route path="conexoes" element={<Navigate to="/configuracoes?tab=connections" replace />} />
        <Route path="configuracoes" element={<ConfiguracoesPage />} />
        <Route path="*" element={<Navigate to="/atendimento" replace />} />
      </Route>
    </Routes>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthenticatedApp />
    </BrowserRouter>
  );
};

export default App;
