import React, { useState, useEffect } from 'react';
import { QrCode, RefreshCw, Smartphone, ShieldCheck, CheckCircle } from 'lucide-react';
import { WhatsappInstance } from '../types';
import { EvolutionApiService } from '../services/evolutionApi';

export const ConexoesPage: React.FC = () => {
  const instanceName = import.meta.env.VITE_EVOLUTION_INSTANCE_NAME || 'vitstock_atendimento';
  const isMock = import.meta.env.VITE_USE_MOCK_DATA === 'true';

  const [instance, setInstance] = useState<WhatsappInstance>({
    id: 'inst-main',
    name: instanceName,
    status: 'disconnected'
  });
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-polling a cada 3 segundos para detectar a conexão automaticamente sem F5
  useEffect(() => {
    fetchStatus();

    const interval = setInterval(() => {
      if (instance.status !== 'connected') {
        fetchStatus(false);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [instance.status]);

  const fetchStatus = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    const statusData = await EvolutionApiService.getInstanceStatus(instanceName);
    setInstance(statusData);

    if (statusData.status !== 'connected' && !isMock) {
      const qr = await EvolutionApiService.getConnectQrCode(instanceName);
      if (qr) setQrCodeBase64(qr);
    }
    if (showLoading) setLoading(false);
  };

  const handleConnectOrRefresh = async () => {
    setLoading(true);
    if (isMock) {
      setTimeout(() => {
        setLoading(false);
        setInstance(prev => ({ ...prev, status: 'connected' }));
      }, 1000);
      return;
    }

    const statusData = await EvolutionApiService.getInstanceStatus(instanceName);
    setInstance(statusData);

    if (statusData.status !== 'connected') {
      const qr = await EvolutionApiService.getConnectQrCode(instanceName);
      if (qr) {
        setQrCodeBase64(qr);
      }
    }
    setLoading(false);
  };

  return (
    <div className="flex-1 h-full p-6 overflow-y-auto bg-zinc-950 font-overpass">
      
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-extrabold text-zinc-100 flex items-center gap-2">
            Gestão de Conexões WhatsApp (Evolution API)
            {instance.status === 'connected' ? (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold">
                WhatsApp Conectado em Tempo Real
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
                instance.status === 'connected' 
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]' 
                  : 'bg-amber-400/10 text-amber-400 border border-amber-400/30'
              }`}>
                <span className={`w-2.5 h-2.5 rounded-full ${instance.status === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400 animate-ping'}`} />
                {instance.status === 'connected' ? 'ONLINE (Conectado)' : 'Aguardando Leitura do QR Code'}
              </span>
            </div>
          </div>

          {/* Se estiver CONECTADO */}
          {instance.status === 'connected' ? (
            <div className="p-6 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-center space-y-3 animate-fade-in">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/40">
                <CheckCircle className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-emerald-400">WhatsApp Pareado & Pronto para Atendimento!</h4>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Suas mensagens de entrada e saída estão sendo sincronizadas via WebSocket com a sua Evolution API na Oracle Cloud.
              </p>
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
            </div>
          )}

          {/* Dados técnicos da conexão */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-zinc-500 block mb-0.5 font-bold">Servidor API Nuvem</span>
              <span className="text-zinc-200 font-mono font-semibold">http://147.15.34.119:8080</span>
            </div>
            <div>
              <span className="text-zinc-500 block mb-0.5 font-bold">Webhooks & Sessão</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" /> WebSocket Conectado
              </span>
            </div>
            <div>
              <span className="text-zinc-500 block mb-0.5 font-bold">Banco de Dados</span>
              <span className="text-zinc-200 font-mono">PostgreSQL</span>
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
