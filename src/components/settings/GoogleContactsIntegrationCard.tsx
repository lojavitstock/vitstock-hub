import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, CloudOff, Loader2, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../services/api';
import { useAuth } from '../../auth/AuthContext';

type GoogleIntegrationState = 'not_connected' | 'connected' | 'reconnect_required' | 'syncing' | 'error';
type GoogleConnection = {
  google_email: string | null;
  connected_at: string;
  sync_status: string;
  last_sync_at: string | null;
  last_sync_imported: number | null;
  last_sync_total: number | null;
  last_sync_error: string | null;
};
type GoogleStatus = {
  connected: boolean;
  state: GoogleIntegrationState;
  connection: GoogleConnection | null;
};

const stateLabel: Record<GoogleIntegrationState, string> = {
  not_connected: 'Não conectado',
  connected: 'Conectado',
  reconnect_required: 'Reconexão necessária',
  syncing: 'Sincronizando',
  error: 'Erro',
};

const formatDate = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : 'Ainda não sincronizado';

export const GoogleContactsIntegrationCard: React.FC = () => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const isAdmin = user?.role === 'admin';

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<GoogleStatus>('/api/google/status');
      setStatus(result);
      window.dispatchEvent(new CustomEvent('vitstock:google-status', { detail: result.state }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar o estado do Google Contacts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const result = searchParams.get('google');
    if (result === 'connected' || result === 'mock-connected') setFeedback('Google Contacts conectado com sucesso.');
    if (result === 'error') setError('Não foi possível concluir a autorização do Google. Tente conectar novamente.');
  }, [searchParams]);

  const currentState = status?.state || 'not_connected';
  const connection = status?.connection;
  const stateTone = useMemo(() => {
    if (currentState === 'connected') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300';
    if (currentState === 'reconnect_required' || currentState === 'error') return 'border-red-400/30 bg-red-400/10 text-red-300';
    if (currentState === 'syncing') return 'border-sky-400/30 bg-sky-400/10 text-sky-300';
    return 'border-zinc-700 bg-zinc-900 text-zinc-300';
  }, [currentState]);

  const connect = async () => {
    if (!isAdmin) return;
    setAction('connect'); setError(''); setFeedback('');
    try {
      const result = await apiRequest<{ url: string }>('/api/google/connect');
      window.location.assign(result.url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível iniciar a conexão com o Google.');
      setAction(null);
    }
  };

  const sync = async () => {
    if (!isAdmin) return;
    setAction('sync'); setError(''); setFeedback('');
    window.dispatchEvent(new CustomEvent('vitstock:google-status', { detail: 'syncing' }));
    try {
      const result = await apiRequest<{ imported: number; total: number; partial?: boolean; errors?: unknown[] }>('/api/google/sync', { method: 'POST' });
      const failed = result.errors?.length ?? Math.max(0, result.total - result.imported);
      setFeedback(result.partial || failed > 0
        ? `Sincronização concluída parcialmente: ${result.imported} de ${result.total}.`
        : `${result.imported} contatos sincronizados de ${result.total}.`);
      await loadStatus();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível sincronizar os contatos.');
      await loadStatus();
    } finally {
      setAction(null);
    }
  };

  const disconnect = async () => {
    if (!isAdmin || !window.confirm('Deseja desconectar o Google Contacts? Seus contatos, conversas, mensagens e tags no Hub serão preservados.')) return;
    setAction('disconnect'); setError(''); setFeedback('');
    try {
      await apiRequest<{ disconnected: boolean }>('/api/google/disconnect', { method: 'DELETE' });
      setFeedback('Google Contacts desconectado. Os dados locais foram preservados.');
      await loadStatus();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível desconectar o Google Contacts.');
    } finally {
      setAction(null);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h3 className="text-lg font-extrabold text-zinc-100">Integrações</h3>
        <p className="mt-1 text-sm text-zinc-400">Conecte serviços externos sem misturar credenciais ou apagar dados locais.</p>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-[#0C0C0E] p-5 shadow-xl" aria-labelledby="google-contacts-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-amber-300"><Cloud className="h-6 w-6" /></div>
            <div>
              <h4 id="google-contacts-title" className="text-base font-extrabold text-zinc-100">Google Contacts</h4>
              <p className="mt-1 max-w-xl text-sm text-zinc-400">Sincronize os contatos do Google com a base de contatos do Vitstock Hub.</p>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${stateTone}`}>
            {currentState === 'syncing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {currentState === 'connected' && <CheckCircle2 className="h-3.5 w-3.5" />}
            {(currentState === 'reconnect_required' || currentState === 'error') && <AlertTriangle className="h-3.5 w-3.5" />}
            {stateLabel[currentState]}
          </span>
        </div>

        {loading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin text-amber-300" /> Verificando integração...</div>
        ) : (
          <>
            {connection && <div className="mt-5 grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm md:grid-cols-2">
              <div><span className="block text-xs font-bold uppercase tracking-wide text-zinc-500">Conta Google</span><span className="text-zinc-200">{connection.google_email || 'Conta conectada'}</span></div>
              <div><span className="block text-xs font-bold uppercase tracking-wide text-zinc-500">Última sincronização</span><span className="text-zinc-200">{formatDate(connection.last_sync_at)}</span></div>
              {connection.last_sync_at && <div><span className="block text-xs font-bold uppercase tracking-wide text-zinc-500">Resultado</span><span className="text-zinc-200">{connection.last_sync_imported ?? 0} de {connection.last_sync_total ?? 0} contatos</span></div>}
              <div><span className="block text-xs font-bold uppercase tracking-wide text-zinc-500">Conexão criada em</span><span className="text-zinc-200">{formatDate(connection.connected_at)}</span></div>
            </div>}

            {currentState === 'reconnect_required' && <p className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">Sua conexão com o Google expirou ou foi revogada. Reconecte sua conta para continuar sincronizando os contatos.</p>}
            {currentState === 'error' && connection?.last_sync_error && <p className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{connection.last_sync_error}</p>}
            {!isAdmin && <p className="mt-4 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-400"><ShieldCheck className="h-4 w-4 text-emerald-300" /> Apenas administradores podem alterar esta integração.</p>}

            <div className="mt-5 flex flex-wrap gap-2 border-t border-zinc-800 pt-4">
              {isAdmin && currentState === 'not_connected' && <button type="button" onClick={() => void connect()} disabled={action !== null} className="btn-primary text-sm"><Cloud className="h-4 w-4" />{action === 'connect' ? 'Abrindo Google...' : 'Conectar Google'}</button>}
              {isAdmin && currentState === 'reconnect_required' && <button type="button" onClick={() => void connect()} disabled={action !== null} className="btn-primary text-sm"><RefreshCw className="h-4 w-4" />{action === 'connect' ? 'Abrindo Google...' : 'Reconectar Google'}</button>}
              {isAdmin && (currentState === 'connected' || currentState === 'syncing' || currentState === 'error') && <button type="button" onClick={() => void sync()} disabled={action !== null || currentState === 'syncing'} className="btn-primary text-sm"><RefreshCw className={`h-4 w-4 ${action === 'sync' ? 'animate-spin' : ''}`} />{action === 'sync' || currentState === 'syncing' ? 'Sincronizando...' : currentState === 'error' ? 'Tentar novamente' : 'Sincronizar agora'}</button>}
              {isAdmin && connection && <button type="button" onClick={() => void disconnect()} disabled={action !== null} className="btn-secondary text-sm"><LogOut className="h-4 w-4" />{action === 'disconnect' ? 'Desconectando...' : 'Desconectar Google'}</button>}
              {!isAdmin && currentState === 'not_connected' && <span className="text-sm text-zinc-500">Solicite a um administrador que conecte o Google Contacts.</span>}
            </div>
          </>
        )}
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
        {feedback && <p role="status" className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{feedback}</p>}
        <p className="mt-4 flex items-center gap-2 text-xs text-zinc-500"><CloudOff className="h-3.5 w-3.5" /> Desconectar remove apenas o vínculo de sincronização; nada é apagado do Hub ou da conta Google.</p>
      </section>
    </div>
  );
};
