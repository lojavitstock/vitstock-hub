import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, QrCode, RefreshCw, Smartphone, ShieldCheck, CheckCircle } from 'lucide-react';
import { WhatsappInstance } from '../types';
import { EvolutionApiService } from '../services/evolutionApi';

type ConexoesPageProps = {
  embedded?: boolean;
};

const CONNECTING_GRACE_MS = 15_000;
const QR_REFRESH_INTERVAL_MS = 30_000;

type ConnectionUiMode = 'connected' | 'auto-reconnecting' | 'waiting-for-qr' | 'requesting-qr' | 'error';

type PairingMemory = {
  active: boolean;
  qrCode: string | null;
  qrUpdatedAt: number | null;
};

// Mantém somente o contexto temporário de pareamento durante a navegação SPA.
// Não é persistência permanente e é resetado assim que a Evolution informa `open`.
const pairingMemory: PairingMemory = { active: false, qrCode: null, qrUpdatedAt: null };
let sharedQrRequest: Promise<string | null> | null = null;

const rememberPairing = () => {
  pairingMemory.active = true;
};

const resetPairingMemory = () => {
  pairingMemory.active = false;
  pairingMemory.qrCode = null;
  pairingMemory.qrUpdatedAt = null;
};

const isRememberedQrStale = () => (
  !pairingMemory.qrCode
  || !pairingMemory.qrUpdatedAt
  || Date.now() - pairingMemory.qrUpdatedAt >= QR_REFRESH_INTERVAL_MS
);

export const ConexoesPage: React.FC<ConexoesPageProps> = ({ embedded = false }) => {
  const instanceName = 'vitstock_atendimento';
  const isMock = import.meta.env.VITE_USE_MOCK_DATA === 'true';
  const initialUiMode: ConnectionUiMode = pairingMemory.active
    ? (pairingMemory.qrCode ? 'waiting-for-qr' : 'requesting-qr')
    : 'requesting-qr';

  const [instance, setInstance] = useState<WhatsappInstance>({
    id: 'inst-main',
    name: instanceName,
    status: 'disconnected'
  });
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(pairingMemory.qrCode);
  const [loading, setLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [uiMode, setUiMode] = useState<ConnectionUiMode>(initialUiMode);
  const qrCodeRef = useRef<string | null>(pairingMemory.qrCode);
  const mountedRef = useRef(true);
  const connectionStatusRef = useRef<WhatsappInstance['status']>('disconnected');
  const connectingTimerRef = useRef<number | null>(null);
  const qrRefreshTimerRef = useRef<number | null>(null);

  const setUiModeSafe = useCallback((mode: ConnectionUiMode) => {
    if (mountedRef.current) setUiMode(mode);
  }, []);

  const updateQrCode = useCallback((value: string | null) => {
    qrCodeRef.current = value;
    if (value) {
      rememberPairing();
      pairingMemory.qrCode = value;
      pairingMemory.qrUpdatedAt = Date.now();
    } else {
      pairingMemory.qrCode = null;
      pairingMemory.qrUpdatedAt = null;
    }
    if (mountedRef.current) setQrCodeBase64(value);
  }, []);

  const requestQrCode = useCallback(async (force = false) => {
    if (isMock) return null;
    rememberPairing();
    setUiModeSafe('requesting-qr');

    const knownQr = qrCodeRef.current || pairingMemory.qrCode;
    if (sharedQrRequest) {
      return sharedQrRequest.then((qr) => {
        if (qr && mountedRef.current && connectionStatusRef.current !== 'connected') {
          updateQrCode(qr);
          setUiModeSafe('waiting-for-qr');
          setConnectionError(null);
        }
        return qr;
      });
    }
    if (!force && knownQr && !isRememberedQrStale()) {
      if (!qrCodeRef.current) updateQrCode(knownQr);
      setUiModeSafe('waiting-for-qr');
      return knownQr;
    }

    const request = EvolutionApiService.getConnectQrCode(instanceName)
      .then((qr) => {
        if (qr && connectionStatusRef.current !== 'connected') {
          pairingMemory.qrCode = qr;
          pairingMemory.qrUpdatedAt = Date.now();
          if (mountedRef.current) {
            updateQrCode(qr);
            setUiModeSafe('waiting-for-qr');
            setConnectionError(null);
          }
        }
        return qr;
      })
      .finally(() => {
        sharedQrRequest = null;
      });
    sharedQrRequest = request;
    return request;
  }, [instanceName, isMock, setUiModeSafe, updateQrCode]);

  const clearReconnectTimers = useCallback(() => {
    if (connectingTimerRef.current !== null) {
      window.clearTimeout(connectingTimerRef.current);
      connectingTimerRef.current = null;
    }
    if (qrRefreshTimerRef.current !== null) {
      window.clearTimeout(qrRefreshTimerRef.current);
      qrRefreshTimerRef.current = null;
    }
  }, []);

  const clearConnectingTimer = useCallback(() => {
    if (connectingTimerRef.current !== null) {
      window.clearTimeout(connectingTimerRef.current);
      connectingTimerRef.current = null;
    }
  }, []);

  const scheduleQrRefresh = useCallback(() => {
    clearConnectingTimer();
    if (qrRefreshTimerRef.current !== null || connectionStatusRef.current === 'connected') return;
    qrRefreshTimerRef.current = window.setTimeout(() => {
      qrRefreshTimerRef.current = null;
      if (!mountedRef.current || connectionStatusRef.current === 'connected') return;
      void requestQrCode(true).finally(() => {
        if (mountedRef.current && connectionStatusRef.current !== 'connected') scheduleQrRefresh();
      });
    }, QR_REFRESH_INTERVAL_MS);
  }, [clearConnectingTimer, requestQrCode]);

  const scheduleConnectingFallback = useCallback(() => {
    if (connectingTimerRef.current !== null || connectionStatusRef.current !== 'connecting') return;
    connectingTimerRef.current = window.setTimeout(() => {
      connectingTimerRef.current = null;
      if (!mountedRef.current || connectionStatusRef.current !== 'connecting') return;
      void requestQrCode(true).finally(() => {
        if (mountedRef.current && connectionStatusRef.current !== 'connected') scheduleQrRefresh();
      });
    }, CONNECTING_GRACE_MS);
  }, [requestQrCode, scheduleQrRefresh]);

  const ensureReconnectPath = useCallback((status: WhatsappInstance['status'], forceQr = false) => {
    connectionStatusRef.current = status;
    if (status === 'connected') {
      clearReconnectTimers();
      updateQrCode(null);
      resetPairingMemory();
      setUiModeSafe('connected');
      setConnectionError(null);
      return;
    }

    if (status !== 'connecting') clearConnectingTimer();

    const knownQr = qrCodeRef.current || pairingMemory.qrCode;
    const pairingActive = pairingMemory.active || Boolean(knownQr);

    if (status === 'connecting' && !forceQr && !pairingActive) {
      setUiModeSafe('auto-reconnecting');
      scheduleConnectingFallback();
      return;
    }

    if (status === 'connecting' && !forceQr && pairingActive && knownQr && !isRememberedQrStale()) {
      rememberPairing();
      if (!qrCodeRef.current) updateQrCode(knownQr);
      setUiModeSafe('waiting-for-qr');
      scheduleQrRefresh();
      return;
    }

    rememberPairing();
    setUiModeSafe('requesting-qr');
    void requestQrCode(forceQr).then((qr) => {
      if (!mountedRef.current || connectionStatusRef.current === 'connected') return;
      if (!qr && !qrCodeRef.current) {
        setUiModeSafe('error');
        setConnectionError('A Evolution API ainda não entregou o QR Code. O sistema tentará novamente automaticamente.');
      }
      scheduleQrRefresh();
    });
  }, [clearConnectingTimer, clearReconnectTimers, requestQrCode, scheduleConnectingFallback, scheduleQrRefresh, setUiModeSafe, updateQrCode]);

  // A consulta de status e a busca do QR Code são automáticas; o botão acima é apenas fallback.
  useEffect(() => {
    mountedRef.current = true;
    if (pairingMemory.active) {
      if (pairingMemory.qrCode) {
        qrCodeRef.current = pairingMemory.qrCode;
        setQrCodeBase64(pairingMemory.qrCode);
      }
      setUiModeSafe(pairingMemory.qrCode ? 'waiting-for-qr' : 'requesting-qr');
    }
    void fetchStatus();

    const interval = window.setInterval(() => { void fetchStatus(false); }, 30000);
    const handleSharedStatus = (event: Event) => {
      const status = (event as CustomEvent<WhatsappInstance['status']>).detail;
      if (status !== 'connected' && status !== 'connecting' && status !== 'disconnected') return;
      setInstance((previous) => ({ ...previous, status }));
      ensureReconnectPath(status);
    };
    window.addEventListener('vitstock:whatsapp-status', handleSharedStatus);

    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      clearReconnectTimers();
      window.removeEventListener('vitstock:whatsapp-status', handleSharedStatus);
    };
  }, [clearReconnectTimers, ensureReconnectPath, setUiModeSafe]);

  const fetchStatus = async (showLoading = true, forceQr = false) => {
    if (showLoading) setLoading(true);
    try {
      const statusData = await EvolutionApiService.getInstanceStatus(instanceName);
      if (!mountedRef.current) return;
      setInstance(statusData);
      ensureReconnectPath(statusData.status, forceQr);
    } catch (error) {
      if (mountedRef.current) {
        setUiModeSafe('error');
        setConnectionError(error instanceof Error ? error.message : 'Não foi possível consultar o status do WhatsApp.');
      }
    } finally {
      if (showLoading && mountedRef.current) setLoading(false);
    }
  };

  const handleConnectOrRefresh = async () => {
    setConnectionError(null);
    await fetchStatus(true, true);
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Desconectar o WhatsApp e gerar um novo QR Code? O pareamento atual será encerrado.')) return;

    setDisconnecting(true);
    setConnectionError(null);
    rememberPairing();
    setUiModeSafe('requesting-qr');
    updateQrCode(null);

    try {
      await EvolutionApiService.logoutInstance(instanceName);
      setInstance(prev => ({ ...prev, status: 'disconnected', phone: '' }));
      connectionStatusRef.current = 'disconnected';

      const qr = await requestQrCode(true);
      if (qr) {
        updateQrCode(qr);
        setUiModeSafe('waiting-for-qr');
      } else {
        setUiModeSafe('error');
        setConnectionError('A sessão foi desconectada, mas a Evolution API ainda não entregou o QR Code. Use “Verificar novamente” para tentar novamente.');
      }
      scheduleQrRefresh();
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Não foi possível desconectar o WhatsApp.');
      await fetchStatus(false);
    } finally {
      setDisconnecting(false);
    }
  };

  const visibleStatus = instance.status;
  const isConnected = uiMode === 'connected';
  const isAutoReconnecting = uiMode === 'auto-reconnecting';
  const isPairingError = uiMode === 'error';

  return (
    <div className={`${embedded ? 'w-full' : 'flex-1 h-full'} overflow-y-auto bg-zinc-950 ${embedded ? 'p-0' : 'p-6'} font-overpass`}>
      
      {/* Header */}
      <div className="mb-6 flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-zinc-100">
            Gestão de Conexões WhatsApp (Evolution API)
            {isConnected ? (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold">
                WhatsApp Conectado em Tempo Real
              </span>
            ) : isAutoReconnecting ? (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-400/10 text-amber-300 border border-amber-400/30 font-bold animate-pulse">
                Reconectando
              </span>
            ) : isPairingError ? (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-red-500/10 text-red-300 border border-red-500/30 font-bold">
                Erro na reconexão
              </span>
            ) : (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/30 font-bold animate-pulse">
                Aguardando Leitura
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Conexão com a Evolution API v2 em produção na Oracle Cloud
          </p>
        </div>

        <button 
          onClick={handleConnectOrRefresh}
          disabled={loading}
        className="btn-primary text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 
          {loading ? 'Verificando...' : 'Verificar novamente'}
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
                <p className="text-xs font-mono text-amber-400">
                  {instance.phone || (visibleStatus === 'connected' ? 'Número conectado' : visibleStatus === 'connecting' ? 'Reconectando...' : 'Desconectado')}
                </p>
                <p className="text-[11px] text-zinc-500 font-mono">Instância: {instanceName}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-2 ${
                isConnected
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]' 
                  : isAutoReconnecting
                    ? 'bg-amber-400/10 text-amber-300 border border-amber-400/30'
                    : isPairingError
                      ? 'bg-red-500/10 text-red-300 border border-red-500/30'
                      : 'bg-amber-400/10 text-amber-300 border border-amber-400/30'
              }`}>
                <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : isPairingError ? 'bg-red-500' : 'bg-amber-400 animate-pulse'}`} />
                {isConnected ? 'ONLINE (Conectado)' : isAutoReconnecting ? 'Reconectando sessão' : uiMode === 'error' ? 'Falha ao obter QR Code' : 'Aguardando novo QR Code'}
              </span>
            </div>
          </div>

          {/* Se estiver CONECTADO */}
          {isConnected ? (
            <div className="p-6 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-center space-y-3 animate-fade-in">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/40">
                <CheckCircle className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-emerald-400">WhatsApp Pareado & Pronto para Atendimento!</h4>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Suas mensagens de entrada e saída estão sendo sincronizadas em tempo real com a sua Evolution API na Oracle Cloud.
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
          ) : isAutoReconnecting ? (
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
            /* Sem conexão aberta: exibir o QR Code enquanto a reconexão é concluída */
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
                <CheckCircle className="w-3.5 h-3.5" /> Eventos em Tempo Real Ativos
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
            
          </div>

        </div>

      </div>

    </div>
  );
};
