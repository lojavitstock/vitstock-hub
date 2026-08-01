import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { AtendimentoPage } from './pages/AtendimentoPage';
import { ContatosPage } from './pages/ContatosPage';
import { FunilPage } from './pages/FunilPage';
import { CampanhasPage } from './pages/CampanhasPage';
import { ConexoesPage } from './pages/ConexoesPage';
import { ConfiguracoesPage } from './pages/ConfiguracoesPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Navigate to="/atendimento" replace />} />
          <Route path="atendimento" element={<AtendimentoPage />} />
          <Route path="contatos" element={<ContatosPage />} />
          <Route path="funil" element={<FunilPage />} />
          <Route path="campanhas" element={<CampanhasPage />} />
          <Route path="conexoes" element={<ConexoesPage />} />
          <Route path="configuracoes" element={<ConfiguracoesPage />} />
          <Route path="*" element={<Navigate to="/atendimento" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
