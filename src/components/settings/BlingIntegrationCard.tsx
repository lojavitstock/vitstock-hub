import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { apiRequest } from '../../services/api';

type Status = { configured: boolean; connected: boolean; connectedAt: string | null };
export const BlingIntegrationCard: React.FC = () => {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => setStatus(await apiRequest<Status>('/api/integrations/bling/status'));
  useEffect(() => { void load().catch(() => setError('Não foi possível verificar a conexão Bling.')); }, []);
  const action = async (kind: 'connect' | 'disconnect') => {
    if (user?.role !== 'admin') return;
    if (kind === 'disconnect' && !window.confirm('Desconectar o Bling? Os produtos locais serão preservados.')) return;
    setBusy(true); setError('');
    try {
      const result = await apiRequest<{ url?: string }>(`/api/integrations/bling/${kind}`, { method: 'POST' });
      if (kind === 'connect' && result.url) window.location.assign(result.url);
      else await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir a ação.'); }
    finally { setBusy(false); }
  };
  return <section aria-labelledby="bling-title" className="mt-5 max-w-3xl rounded-xl border border-zinc-800 bg-[#0C0C0E] p-5">
    <h4 id="bling-title" className="text-base font-extrabold text-zinc-100">Bling</h4>
    <p className="mt-2 text-sm text-zinc-400">Conexão segura para leitura de produtos, depósitos e estoque. Sem sincronização com a biblioteca local.</p>
    <p data-testid="bling-status" className="mt-4 text-sm text-zinc-200">{!status ? 'Verificando conexão...' : status.connected ? 'Conectado' : 'Não conectado'}</p>
    {status?.connectedAt && <p className="mt-2 text-xs text-zinc-400">Conectado em {new Date(status.connectedAt).toLocaleString('pt-BR')}</p>}
    {status && !status.configured && <p className="mt-3 text-sm text-zinc-400">Integração ainda não configurada no servidor.</p>}
    {user?.role === 'admin' && status?.configured && <button type="button" disabled={busy} className="btn-primary mt-4 text-sm" onClick={() => void action(status.connected ? 'disconnect' : 'connect')}>
      {busy ? 'Aguarde...' : status.connected ? 'Desconectar Bling' : 'Conectar Bling'}
    </button>}
    {user?.role !== 'admin' && <p className="mt-3 text-sm text-zinc-400">Apenas administradores podem alterar esta integração.</p>}
    {(error || params.get('bling') === 'error') && <p role="alert" className="mt-3 text-sm text-red-300">{error || 'Autorização Bling inválida, expirada ou recusada. Tente novamente.'}</p>}
    <p className="mt-4 text-xs text-zinc-500">Desconectar remove apenas a conexão no Hub. Para revogar a autorização, use os aplicativos autorizados no Bling.</p>
  </section>;
};
