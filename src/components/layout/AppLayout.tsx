import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { 
  MessageSquare, 
  Users, 
  Megaphone, 
  QrCode, 
  Settings, 
  Wifi, 
  WifiOff,
  RefreshCw,
  LogOut
} from 'lucide-react';
import { EvolutionApiService } from '../../services/evolutionApi';
import { useAuth } from '../../auth/AuthContext';

export const AppLayout: React.FC = () => {
  const location = useLocation();
  const { user: currentUser, logout } = useAuth();
  const instanceName = 'vitstock_atendimento';
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');

  useEffect(() => {
    const syncSharedStatus = (event: Event) => {
      setConnectionStatus((event as CustomEvent<'connected' | 'connecting' | 'disconnected'>).detail);
    };
    const checkConnection = async () => {
      const statusData = await EvolutionApiService.getInstanceStatus(instanceName);
      setConnectionStatus(statusData.status);
    };

    window.addEventListener('vitstock:whatsapp-status', syncSharedStatus);
    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => {
      window.removeEventListener('vitstock:whatsapp-status', syncSharedStatus);
      clearInterval(interval);
    };
  }, [instanceName]);

  const navItems: Array<{
    path: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }> = [
    { path: '/atendimento', label: 'Atendimento', icon: MessageSquare },
    { path: '/contatos', label: 'Contatos', icon: Users },
    { path: '/campanhas', label: 'Campanhas', icon: Megaphone },
    { path: '/conexoes', label: 'Conexões', icon: QrCode },
    { path: '/configuracoes', label: 'Configurações', icon: Settings },
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#11181d] text-slate-100 font-overpass">
      {/* Sidebar Lateral Desktop (Layout Vitstock Hub) */}
      <aside className="w-20 flex-shrink-0 bg-[#182126] border-r border-[#344047] flex flex-col justify-between select-none">
        
        {/* Top Header: Logo Oficial VITSTOCK® */}
        <div>
          <div className="flex items-center justify-center border-b border-[#344047] bg-[#20292f] p-3">
            <div className="flex h-11 w-11 min-w-[44px] max-w-[44px] max-h-[44px] items-center justify-center overflow-hidden rounded-2xl border border-amber-400/30 bg-amber-400/10 p-1.5 shadow-[0_0_15px_rgba(238,187,44,0.15)]" title="Vitstock Hub">
              <img 
                src="/VITSTOCK®/SIMBOLO/1.png" 
                alt="VITSTOCK Simbolo" 
                className="w-full h-full object-contain"
                style={{ maxWidth: '28px', maxHeight: '28px' }}
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
          </div>

          {/* Menu de Navegação em Português */}
          <nav className="space-y-1.5 p-2" aria-label="Menu principal">
            <span className="sr-only">Menu Principal</span>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path || (item.path === '/atendimento' && location.pathname === '/');
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  title={item.label}
                  aria-label={item.label}
                  className={({ isActive: navActive }) => {
                    const active = navActive || (item.path === '/atendimento' && location.pathname === '/');
                    return `group flex min-h-11 items-center justify-center rounded-xl border px-2 py-2.5 text-[13px] font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 ${
                      active
                        ? 'border-amber-300/40 bg-amber-400/15 text-amber-200 font-bold shadow-[inset_3px_0_0_#EEBB2C,0_4px_14px_rgba(0,0,0,0.12)]'
                        : 'border-transparent text-slate-300 hover:border-[#3c4a51] hover:bg-[#263138] hover:text-white'
                    }`;
                  }}
                >
                  <div className="flex items-center justify-center">
                    <Icon className={`h-5 w-5 flex-shrink-0 transition-colors ${isActive ? 'text-amber-300' : 'text-slate-400 group-hover:text-slate-200'}`} />
                    <span className="sr-only">{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                      isActive 
                        ? 'bg-zinc-950 text-amber-400' 
                        : 'bg-zinc-800 text-amber-400 border border-amber-400/20'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Bottom Section: Status da Conexão & Perfil do Atendente */}
        <div className="border-t border-[#344047] bg-[#151e23] p-2">
          
          {/* Status WhatsApp (Evolution API em Tempo Real) */}
          <div
            className="mb-2 flex h-11 items-center justify-center rounded-xl border border-[#3a474e] bg-[#20292f]"
            title={connectionStatus === 'connected' ? 'WhatsApp conectado' : connectionStatus === 'connecting' ? 'Reconectando WhatsApp' : 'WhatsApp desconectado'}
            aria-label={connectionStatus === 'connected' ? 'WhatsApp conectado' : connectionStatus === 'connecting' ? 'Reconectando WhatsApp' : 'WhatsApp desconectado'}
          >
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-400' : connectionStatus === 'connecting' ? 'bg-amber-400' : 'bg-red-400'} opacity-75`}></span>
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connectionStatus === 'connected' ? 'bg-emerald-500' : connectionStatus === 'connecting' ? 'bg-amber-400' : 'bg-red-500'}`}></span>
            </span>
            {connectionStatus === 'connected' ? (
              <Wifi className="ml-2 h-4 w-4 text-emerald-400" aria-hidden="true" />
            ) : connectionStatus === 'connecting' ? (
              <RefreshCw className="ml-2 h-4 w-4 animate-spin text-amber-400" aria-hidden="true" />
            ) : (
              <WifiOff className="ml-2 h-4 w-4 text-red-400" aria-hidden="true" />
            )}
          </div>

          {/* Card Atendente */}
          <div className="flex flex-col items-center gap-2 rounded-xl p-2 transition-colors hover:bg-[#263138]">
            <div className="flex items-center justify-center">
              <div className="relative">
                <img 
                  src={`https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser?.name || 'Usuário')}&background=EEBB2C&color=000`}
                  alt={currentUser?.name || 'Usuário'}
                  className="h-10 w-10 rounded-full object-cover border border-amber-400/40"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=Leo+Vitorino&background=EEBB2C&color=000';
                  }}
                />
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-zinc-950"></span>
              </div>
            </div>
            <button
              onClick={() => void logout()}
              className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800/50 hover:text-red-400 focus-visible:ring-2 focus-visible:ring-amber-300/70"
              title={`Sair da plataforma${currentUser?.name ? ` — ${currentUser.name}` : ''}`}
              aria-label="Sair da plataforma"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 h-full overflow-hidden bg-[#11181d] flex flex-col">
        <Outlet />
      </main>
    </div>
  );
};
