import React, { useState, useEffect } from 'react';
import { LogOut, QrCode, RefreshCw, Smartphone, ShieldCheck, CheckCircle } from 'lucide-react';
import { WhatsappInstance } from '../types';
import { EvolutionApiService } from '../services/evolutionApi';

export const ConexoesPage: React.FC = () => {
  const instanceName = 'vitstock_atendimento';
  const isMock = import.meta.env.VITE_USE_MOCK_DATA === 'true';

  const [instance, setInstance] = useState<WhatsappInstance>({
    id: 'inst-main',
    name: instanceName,
    status: 'disconnected'
  });
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showManualQr, setShowManualQr] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Consulta somente o estado. O QR Code nunca é regenerado automaticamente.
  useEffect(() => {
    fetchStatus();

    const interval = setInterval(() => fetchStatus(false), 30000);

    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    const statusData = await EvolutionApiService.getInstanceStatus(instanceName);
    setInstance(statusData);
    if (statusData.status === 'connected') setShowManualQr(false);

    if (showLoading) setLoading(false);
  };

  const handleConnectOrRefresh = async () => {
    setConnectionError(null);
    setLoading(true);
    if (isMock) {
      setTimeout(() => {
        setLoading(false);
        setShowManualQr(false);
        setInstance(prev => ({ ...prev, status: 'connected' }));
      }, 1000);
      return;
    }

    const statusData = await EvolutionApiService.getInstanceStatus(instanceName);
    setInstance(statusData);

    if (statusData.status === 'disconnected') {
      setShowManualQr(true);
      const qr = await EvolutionApiService.getConnectQrCode(instanceName);
      if (qr) {
        setQrCodeBase64(qr);
      }
    }
    setLoading(false);
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Desconectar o WhatsApp e gerar um novo QR Code? O pareamento atual será encerrado.')) return;

    setDisconnecting(true);
    setConnectionError(null);
    setQrCodeBase64(null);
    setShowManualQr(true);

    try {
      await EvolutionApiService.logoutInstance(instanceName);
      setInstance(prev => ({ ...prev, status: 'disconnected', phone: '' }));

      const qr = await EvolutionApiService.getConnectQrCode(instanceName);
      if (qr) {
        setQrCodeBase64(qr);
      } else {
        setConnectionError('A sessão foi desconectada, mas a Evolution API ainda não entregou o QR Code. Clique em “Reverificar Status” para tentar novamente.');
      }
    } catch (error) {
      setShowManualQr(false);
      setConnectionError(error instanceof Error ? error.message : 'Não foi possível desconectar o WhatsApp.');
      await fetchStatus(false);
    } finally {
      setDisconnecting(false);
    }
  };

  const showQr = showManualQr || instance.status === 'disconnected';
  const visibleStatus = showQr ? 'disconnected' : instance.status;

  return (
    <div className="flex-1 h-full p-6 overflow-y-auto bg-zinc-950 font-overpass">
      
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-extrabold text-zinc-100 flex items-center gap-2">
            Gestão de Conexões WhatsApp (Evolution API)
            {visibleStatus === 'connected' ? (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold">
                WhatsApp Conectado em Tempo Real
              </span>
            ) : visibleStatus === 'connecting' ? (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-400/10 text-amber-300 border border-amber-400/30 font-bold animate-pulse">
                Reconectando
              </span>
            ) : (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/30 font-bold animate-pulse">
                Aguardando Leitura
              </span>
            )}
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Conexão com a Evolution API v2 em produção na Oracle Cloud
          </p>
        </div>

        <button 
          onClick={handleConnectOrRefresh}
          disabled={loading}
          className="btn-primary text-xs"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 
          {loading ? 'Verificando...' : 'Reverificar Status'}
        </button>
      </div>

      {/* Card da Instância Principal */}
      <div className="max-w-3xl space-y-6">
        
        <div className="p-6 rounded-2xl bg-[#0C0C0E] border border-zinc-800/80 shadow-2xl space-y-6">
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400">
                <Smartphone className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-zinc-100">{instance.profileName || 'Vitstock Atendimento WhatsApp'}</h3>
                <p className="text-xs font-mono text-amber-400">{instance.phone || 'Número Conectado'}</p>
                <p className="text-[11px] text-zinc-500 font-mono">Instância: {instanceName}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-2 ${
                visibleStatus === 'connected'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]' 
                  : visibleStatus === 'connecting'
                    ? 'bg-amber-400/10 text-amber-300 border border-amber-400/30'
                    : 'bg-red-500/10 text-red-300 border border-red-500/30'
              }`}>
                <span className={`w-2.5 h-2.5 rounded-full ${visibleStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : visibleStatus === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-500'}`} />
                {visibleStatus === 'connected' ? 'ONLINE (Conectado)' : visibleStatus === 'connecting' ? 'Reconectando sessão' : 'Aguardando novo QR Code'}
              </span>
            </div>
          </div>

          {/* Se estiver CONECTADO */}
          {visibleStatus === 'connected' ? (
            <div className="p-6 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-center space-y-3 animate-fade-in">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/40">
                <CheckCircle className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-emerald-400">WhatsApp Pareado & Pronto para Atendimento!</h4>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Suas mensagens de entrada e saída estão sendo sincronizadas via WebSocket com a sua Evolution API na Oracle Cloud.
              </p>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={disconnecting || loading}
                className="mx-auto mt-2 px-4 py-2 rounded-lg border border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-300/50 disabled:opacity-50 text-xs font-bold transition-all flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                {disconnecting ? 'Desconectando...' : 'Desconectar e gerar novo QR Code'}
              </button>
            </div>
          ) : visibleStatus === 'connecting' ? (
            <div className="p-8 rounded-xl bg-amber-400/5 border border-amber-400/20 text-center space-y-3 animate-fade-in">
              <RefreshCw className="w-8 h-8 text-amber-300 animate-spin mx-auto" />
              <h4 className="text-sm font-bold text-amber-200">Restabelecendo a sessão do WhatsApp</h4>
              <p className="text-xs text-zinc-400">Uma oscilação temporária não exige nova leitura do QR Code.</p>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={disconnecting || loading}
                className="mx-auto mt-2 px-4 py-2 rounded-lg border border-amber-300/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20 hover:border-amber-200/50 disabled:opacity-50 text-xs font-bold transition-all flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                {disconnecting ? 'Desconectando...' : 'Desconectar e gerar novo QR Code'}
              </button>
            </div>
          ) : (
            /* Se estiver DESCONECTADO (exibir QR Code) */
            <div className="p-8 rounded-xl bg-zinc-900 border border-amber-400/30 text-center space-y-4 animate-fade-in">
              <h4 className="text-sm font-bold text-zinc-100">Escaneie o QR Code abaixo no seu celular</h4>
              
              <div className="w-56 h-56 mx-auto bg-white p-3 rounded-xl shadow-2xl border-4 border-amber-400 flex items-center justify-center">
                {qrCodeBase64 ? (
                  <img src={qrCodeBase64.startsWith('data:') ? qrCodeBase64 : `data:image/png;base64,${qrCodeBase64}`} alt="QR Code WhatsApp" className="w-full h-full object-contain" />
                ) : (
                  <div className="text-center p-4">
                    <QrCode className="w-20 h-20 text-zinc-950 mx-auto mb-2 animate-pulse" />
                    <p className="text-[10px] text-zinc-700 font-bold">Buscando QR Code da API...</p>
                  </div>
                )}
              </div>

              <p className="text-xs text-zinc-400">
                Abra o WhatsApp no celular &gt; Menu (3 pontos) &gt; Aparelhos Conectados &gt; Conectar um Aparelho
              </p>
              {connectionError && <p className="text-xs text-red-300">{connectionError}</p>}
            </div>
          )}

          {connectionError && visibleStatus !== 'disconnected' && (
            <p className="text-xs text-red-300 text-center">{connectionError}</p>
          )}

          {/* Dados técnicos da conexão */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-zinc-500 block mb-0.5 font-bold">Servidor API Nuvem</span>
              <span className="text-zinc-200 font-mono font-semibold truncate block" title={import.meta.env.VITE_API_URL || 'Backend Railway'}>
                {import.meta.env.VITE_API_URL || 'Backend Railway'}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 block mb-0.5 font-bold">Webhooks & Sessão</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" /> WebSocket Conectado
              </span>
            </div>
            <div>
              <span className="text-zinc-500 block mb-0.5 font-bold">Banco de Dados</span>
              <span className="text-zinc-200 font-mono">PostgreSQL (Railway)</span>
            </div>
          </div>

          {/* Botões de Ação */}
          <div className="pt-4 border-t border-zinc-800 flex items-center justify-between">
            <span className="text-xs text-zinc-500 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-amber-400" /> Sincronização em Tempo Real Ativa (Sem F5)
            </span>
            
            <button 
              onClick={handleConnectOrRefresh}
              className="px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-amber-400 hover:border-amber-400/40 text-xs font-bold transition-all flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 
              Atualizar Status
            </button>
          </div>

        </div>

      </div>

    </div>
  );
};
