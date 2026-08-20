import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, Zap, Layers, Plus, KeyRound, Loader2, QrCode, UserPlus, Power, Save, X, PencilLine, Plug } from 'lucide-react';
import { Attendant } from '../types';
import { apiRequest } from '../services/api';
import { useAuth } from '../auth/AuthContext';
import { mockAttendants } from '../services/mockData';
import { ConexoesPage } from './ConexoesPage';
import { GoogleContactsIntegrationCard } from '../components/settings/GoogleContactsIntegrationCard';

type SettingsTab = 'attendants' | 'departments' | 'quickReplies' | 'security' | 'connections' | 'integracoes';
type AttendantFormState = {
  name: string;
  email: string;
  password: string;
  role: 'attendant' | 'admin';
};

const isSettingsTab = (value: string | null): value is SettingsTab => (
  value === 'attendants'
  || value === 'departments'
  || value === 'quickReplies'
  || value === 'security'
  || value === 'connections'
  || value === 'integracoes'
);

export const ConfiguracoesPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => isSettingsTab(searchParams.get('tab')) ? searchParams.get('tab') as SettingsTab : 'attendants');
  const [attendants, setAttendants] = useState<Attendant[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState('');
  const [teamFeedback, setTeamFeedback] = useState('');
  const [showAttendantForm, setShowAttendantForm] = useState(false);
  const [savingAttendant, setSavingAttendant] = useState(false);
  const [updatingAttendantId, setUpdatingAttendantId] = useState<string | null>(null);
  const [editingAttendantId, setEditingAttendantId] = useState<string | null>(null);
  const [savingEditedAttendant, setSavingEditedAttendant] = useState(false);
  const [attendantForm, setAttendantForm] = useState<AttendantFormState>({ name: '', email: '', password: '', role: 'attendant' });
  const [editingAttendantForm, setEditingAttendantForm] = useState<AttendantFormState>({ name: '', email: '', password: '', role: 'attendant' });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordFeedback, setPasswordFeedback] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    if (isSettingsTab(requestedTab) && requestedTab !== activeTab) setActiveTab(requestedTab);
  }, [activeTab, searchParams]);

  const changeTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    setSearchParams(tab === 'attendants' ? {} : { tab });
  };

  const loadAttendants = useCallback(async () => {
    if (user?.role !== 'admin') {
      setAttendants([]);
      return;
    }
    setTeamLoading(true);
    setTeamError('');
    if (import.meta.env.VITE_USE_MOCK_DATA === 'true') {
      setAttendants(mockAttendants);
      setTeamLoading(false);
      return;
    }
    try {
      const response = await apiRequest<{ attendants: Attendant[] }>('/api/team/attendants');
      setAttendants(response.attendants || []);
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : 'Não foi possível carregar a equipe.');
    } finally {
      setTeamLoading(false);
    }
  }, [user?.role]);

  useEffect(() => {
    if (activeTab === 'attendants' && user?.role === 'admin') void loadAttendants();
    if (activeTab === 'attendants' && user?.role !== 'admin') setAttendants([]);
  }, [activeTab, loadAttendants, user]);

  const resetAttendantForm = () => {
    setAttendantForm({ name: '', email: '', password: '', role: 'attendant' });
    setShowAttendantForm(false);
  };

  const cancelEditAttendant = () => {
    setEditingAttendantId(null);
    setEditingAttendantForm({ name: '', email: '', password: '', role: 'attendant' });
  };

  const openEditAttendant = (attendant: Attendant) => {
    setTeamError('');
    setTeamFeedback('');
    setShowAttendantForm(false);
    setEditingAttendantId(attendant.id);
    setEditingAttendantForm({
      name: attendant.name,
      email: attendant.email || '',
      password: '',
      role: attendant.role,
    });
  };

  const handleCreateAttendant = async (event: React.FormEvent) => {
    event.preventDefault();
    setTeamError('');
    setTeamFeedback('');
    setSavingAttendant(true);
    try {
      await apiRequest('/api/team/attendants', {
        method: 'POST',
        body: JSON.stringify(attendantForm),
      });
      resetAttendantForm();
      setTeamFeedback('Atendente cadastrado com sucesso.');
      await loadAttendants();
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : 'Não foi possível cadastrar o atendente.');
    } finally {
      setSavingAttendant(false);
    }
  };

  const handleUpdateAttendant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingAttendantId) return;
    setTeamError('');
    setTeamFeedback('');
    setSavingEditedAttendant(true);
    try {
      const payload: Partial<AttendantFormState> = {
        name: editingAttendantForm.name,
        email: editingAttendantForm.email,
        role: editingAttendantForm.role,
      };
      if (editingAttendantForm.password.trim()) payload.password = editingAttendantForm.password;
      const response = await apiRequest<{ attendant: Attendant }>(`/api/team/attendants/${editingAttendantId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setAttendants((current) => current.map((item) => (
        item.id === editingAttendantId
          ? { ...item, ...response.attendant, online: item.online }
          : item
      )));
      setTeamFeedback(`${response.attendant.name} foi atualizado.`);
      cancelEditAttendant();
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : 'Nao foi possivel atualizar o atendente.');
    } finally {
      setSavingEditedAttendant(false);
    }
  };

  const handleToggleAttendant = async (attendant: Attendant) => {
    if (attendant.id === user?.id && attendant.active !== false) return;
    setTeamError('');
    setTeamFeedback('');
    setUpdatingAttendantId(attendant.id);
    try {
      const nextActive = attendant.active === false;
      await apiRequest(`/api/team/attendants/${attendant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: nextActive }),
      });
      setAttendants((current) => current.map((item) => item.id === attendant.id ? { ...item, active: nextActive, online: false } : item));
      setTeamFeedback(nextActive ? `${attendant.name} foi reativado.` : `${attendant.name} foi desativado.`);
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : 'Não foi possível atualizar o atendente.');
    } finally {
      setUpdatingAttendantId(null);
    }
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordFeedback('');
    setPasswordError('');
    if (newPassword !== confirmPassword) {
      setPasswordError('A confirmação não coincide com a nova senha.');
      return;
    }
    setSavingPassword(true);
    try {
      await apiRequest<{ changed: boolean }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordFeedback('Senha alterada com sucesso.');
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Não foi possível alterar a senha.');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-zinc-950 p-6 font-overpass text-sm">
      
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-800">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-zinc-100">
            Configurações da Plataforma
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Gerencie equipe, setores, conexões e atalhos de mensagens
          </p>
        </div>
      </div>

      {/* Navegação por Abas */}
      <div className="mb-6 flex flex-wrap gap-4 border-b border-zinc-800">
        {[
          { id: 'attendants', label: 'Equipe de Atendimentos', icon: Users },
          { id: 'departments', label: 'Setores & Filas', icon: Layers },
          { id: 'quickReplies', label: 'Respostas Rápidas', icon: Zap },
          { id: 'integracoes', label: 'Integrações', icon: Plug },
          { id: 'connections', label: 'Conexão WhatsApp', icon: QrCode },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => changeTab(tab.id as SettingsTab)}
              className={`flex items-center gap-2 border-b-2 pb-3 text-sm font-bold transition-all ${
                isActive 
                  ? 'border-amber-400 text-amber-400' 
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => changeTab('security')}
          className={`flex items-center gap-2 border-b-2 pb-3 text-sm font-bold transition-all ${activeTab === 'security' ? 'border-amber-400 text-amber-400' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          <KeyRound className="h-4 w-4" /> Minha Senha
        </button>
      </div>

      {/* Conteúdo da Aba */}
      {activeTab === 'security' && (
        <div className="max-w-xl space-y-5">
          <div>
            <h3 className="text-lg font-extrabold text-zinc-100">Alterar minha senha</h3>
            <p className="mt-1 text-sm text-zinc-400">Atualize a senha da conta {user?.email || 'atual'}.</p>
          </div>
          <form onSubmit={handleChangePassword} className="space-y-4 rounded-xl border border-zinc-800 bg-[#0C0C0E] p-5">
            <label className="block text-sm font-bold text-zinc-300">
              Senha atual
              <input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none focus:border-amber-400" />
            </label>
            <label className="block text-sm font-bold text-zinc-300">
              Nova senha
              <input required minLength={8} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none focus:border-amber-400" />
              <span className="mt-1 block text-xs font-normal text-zinc-500">Use pelo menos 8 caracteres.</span>
            </label>
            <label className="block text-sm font-bold text-zinc-300">
              Confirmar nova senha
              <input required minLength={8} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none focus:border-amber-400" />
            </label>
            {passwordError && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{passwordError}</p>}
            {passwordFeedback && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">{passwordFeedback}</p>}
            <div className="flex justify-end border-t border-zinc-800 pt-4">
              <button type="submit" disabled={savingPassword} className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-60">
                {savingPassword && <Loader2 className="w-4 h-4 animate-spin" />}
                {savingPassword ? 'Salvando...' : 'Alterar senha'}
              </button>
            </div>
          </form>
        </div>
      )}

      {activeTab === 'attendants' && (
        <div className="max-w-4xl space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-extrabold text-zinc-100">Equipe de Atendimentos</h3>
              <p className="mt-1 text-sm text-zinc-400">Cadastre e controle quem pode acessar os atendimentos da empresa.</p>
            </div>
            {user?.role === 'admin' && (
              <button type="button" onClick={() => { setTeamError(''); setTeamFeedback(''); cancelEditAttendant(); setShowAttendantForm(true); }} className="btn-primary text-sm">
                <UserPlus className="h-4 w-4" /> Novo atendente
              </button>
            )}
          </div>

          {showAttendantForm && user?.role === 'admin' && (
            <form onSubmit={handleCreateAttendant} className="space-y-4 rounded-xl border border-amber-400/25 bg-amber-400/5 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-base font-extrabold text-zinc-100">Cadastrar atendente</h4>
                  <p className="mt-1 text-sm text-zinc-400">A pessoa poderá entrar com o e-mail e a senha provisória informada.</p>
                </div>
                <button type="button" onClick={resetAttendantForm} className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-zinc-100" aria-label="Fechar formulário">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-bold text-zinc-300">
                  Nome completo
                  <input required minLength={2} value={attendantForm.name} onChange={(event) => setAttendantForm((current) => ({ ...current, name: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none focus:border-amber-400" placeholder="Ex.: Maria Oliveira" />
                </label>
                <label className="block text-sm font-bold text-zinc-300">
                  E-mail de acesso
                  <input required type="email" value={attendantForm.email} onChange={(event) => setAttendantForm((current) => ({ ...current, email: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none focus:border-amber-400" placeholder="maria@empresa.com" />
                </label>
                <label className="block text-sm font-bold text-zinc-300">
                  Senha provisória
                  <input required minLength={8} type="password" value={attendantForm.password} onChange={(event) => setAttendantForm((current) => ({ ...current, password: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none focus:border-amber-400" placeholder="Mínimo de 8 caracteres" />
                </label>
                <label className="block text-sm font-bold text-zinc-300">
                  Perfil de acesso
                  <select value={attendantForm.role} onChange={(event) => setAttendantForm((current) => ({ ...current, role: event.target.value as 'attendant' | 'admin' }))} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none focus:border-amber-400">
                    <option value="attendant">Atendente</option>
                    <option value="admin">Administrador</option>
                  </select>
                </label>
              </div>
              <div className="flex justify-end border-t border-amber-400/15 pt-4">
                <button type="submit" disabled={savingAttendant} className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-60">
                  {savingAttendant ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {savingAttendant ? 'Salvando...' : 'Salvar atendente'}
                </button>
              </div>
            </form>
          )}

          {teamError && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{teamError}</p>}
          {teamFeedback && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">{teamFeedback}</p>}

          <div className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800 bg-[#0C0C0E]">
            {teamLoading ? (
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-zinc-400"><Loader2 className="h-5 w-5 animate-spin text-amber-400" /> Carregando equipe...</div>
            ) : attendants.length === 0 ? (
              <div className="p-10 text-center text-sm text-zinc-500">Nenhum usuário encontrado nesta empresa.</div>
            ) : (
              attendants.map((attendant) => {
                const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(attendant.name)}&background=EEBB2C&color=000`;
                const active = attendant.active !== false;
                const isEditing = editingAttendantId === attendant.id;
                return (
                  <React.Fragment key={attendant.id}>
                  <div className={`flex items-center justify-between gap-4 p-5 ${!active ? 'opacity-60' : ''}`}>
                    <div className="flex min-w-0 items-center gap-3">
                      <img src={attendant.avatar || fallbackAvatar} alt={attendant.name} className="h-12 w-12 rounded-full border border-amber-400/30 object-cover" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} />
                      <div className="min-w-0">
                        <h4 className="truncate text-base font-bold text-zinc-100">{attendant.name}</h4>
                        <p className="truncate text-sm text-zinc-400">{attendant.email || 'E-mail não informado'}</p>
                        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{attendant.role === 'admin' ? 'Administrador' : 'Atendente'}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className={`rounded-full border px-3 py-1 text-xs font-bold ${active && attendant.online ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : active ? 'border-zinc-700 bg-zinc-800 text-zinc-300' : 'border-zinc-700 bg-zinc-900 text-zinc-500'}`}>
                        {!active ? 'Desativado' : attendant.online ? 'Online' : 'Ativo'}
                      </span>
                      {user?.role === 'admin' && (
                        <>
                          <button type="button" onClick={() => openEditAttendant(attendant)} disabled={savingEditedAttendant || updatingAttendantId === attendant.id} className="rounded-lg border border-amber-400/20 p-2 text-amber-300 transition-colors hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-40" title="Editar atendente">
                            <PencilLine className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => void handleToggleAttendant(attendant)} disabled={updatingAttendantId === attendant.id || attendant.id === user.id} className={`rounded-lg border p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'border-red-400/20 text-red-300 hover:bg-red-400/10' : 'border-emerald-400/20 text-emerald-300 hover:bg-emerald-400/10'}`} title={attendant.id === user.id ? 'Sua conta não pode ser desativada' : active ? 'Desativar atendente' : 'Reativar atendente'}>
                            {updatingAttendantId === attendant.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {isEditing && (
                    <form onSubmit={handleUpdateAttendant} className="space-y-4 border-t border-amber-400/15 bg-amber-400/5 p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-base font-extrabold text-zinc-100">Editar atendente</h4>
                          <p className="mt-1 text-sm text-zinc-400">Atualize nome, e-mail, perfil ou defina uma nova senha.</p>
                        </div>
                        <button type="button" onClick={cancelEditAttendant} className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-zinc-100" aria-label="Fechar edicao">
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="block text-sm font-bold text-zinc-300">
                          Nome completo
                          <input required minLength={2} value={editingAttendantForm.name} onChange={(event) => setEditingAttendantForm((current) => ({ ...current, name: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none focus:border-amber-400" />
                        </label>
                        <label className="block text-sm font-bold text-zinc-300">
                          E-mail de acesso
                          <input required type="email" value={editingAttendantForm.email} onChange={(event) => setEditingAttendantForm((current) => ({ ...current, email: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none focus:border-amber-400" />
                        </label>
                        <label className="block text-sm font-bold text-zinc-300">
                          Nova senha
                          <input minLength={8} type="password" value={editingAttendantForm.password} onChange={(event) => setEditingAttendantForm((current) => ({ ...current, password: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none focus:border-amber-400" placeholder="Deixe em branco para manter" />
                        </label>
                        <label className="block text-sm font-bold text-zinc-300">
                          Perfil de acesso
                          <select value={editingAttendantForm.role} onChange={(event) => setEditingAttendantForm((current) => ({ ...current, role: event.target.value as 'attendant' | 'admin' }))} disabled={attendant.id === user?.id} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none focus:border-amber-400 disabled:cursor-not-allowed disabled:opacity-60">
                            <option value="attendant">Atendente</option>
                            <option value="admin">Administrador</option>
                          </select>
                        </label>
                      </div>
                      <div className="flex justify-end gap-3 border-t border-amber-400/15 pt-4">
                        <button type="button" onClick={cancelEditAttendant} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-bold text-zinc-300 hover:bg-white/5">
                          Cancelar
                        </button>
                        <button type="submit" disabled={savingEditedAttendant} className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-60">
                          {savingEditedAttendant ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          {savingEditedAttendant ? 'Salvando...' : 'Salvar alteracoes'}
                        </button>
                      </div>
                    </form>
                  )}
                  </React.Fragment>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'connections' && <ConexoesPage embedded />}

      {activeTab === 'integracoes' && <GoogleContactsIntegrationCard />}

      {activeTab === 'departments' && (
        <div className="max-w-3xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold text-zinc-100">Setores de Atendimento</h3>
            <button className="btn-primary text-sm"><Plus className="h-4 w-4" /> Criar Setor</button>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {['Vendas', 'Financeiro', 'Suporte Técnico'].map(dept => (
              <div key={dept} className="p-4 rounded-xl bg-[#0C0C0E] border border-zinc-800 text-center space-y-2">
                <h4 className="text-xs font-extrabold text-amber-400">{dept}</h4>
                <p className="text-[11px] text-zinc-400">Distribuição automática por roleta</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'quickReplies' && (
        <div className="max-w-3xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold text-zinc-100">Respostas Rápidas Configuradas</h3>
            <button className="btn-primary text-sm"><Plus className="h-4 w-4" /> Criar Atalho</button>
          </div>

          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-[#0C0C0E] border border-zinc-800 flex items-start justify-between">
              <div>
                <span className="text-xs font-mono font-bold text-amber-400 block mb-1">/proposta</span>
                <p className="text-xs text-zinc-300">Segue a proposta comercial para o lote com 5% de desconto no PIX.</p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">Vendas</span>
            </div>

            <div className="p-4 rounded-xl bg-[#0C0C0E] border border-zinc-800 flex items-start justify-between">
              <div>
                <span className="text-xs font-mono font-bold text-amber-400 block mb-1">/frete</span>
                <p className="text-xs text-zinc-300">O prazo de entrega para Curitiba é de 2 a 3 dias úteis após a confirmação do pagamento.</p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">Logística</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
