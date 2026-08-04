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
  LogOut,
  ShieldCheck
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
      <aside className="w-56 flex-shrink-0 bg-[#182126] border-r border-[#344047] flex flex-col justify-between select-none">
        
        {/* Top Header: Logo Oficial VITSTOCK® */}
        <div>
          <div className="p-4 border-b border-[#344047] bg-[#20292f] flex items-center gap-3">
            <div className="w-10 h-10 min-w-[40px] max-w-[40px] max-h-[40px] overflow-hidden rounded-xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center p-1.5 shadow-[0_0_15px_rgba(238,187,44,0.15)] flex-shrink-0">
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
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold tracking-wide text-lg text-amber-400">vitstock</span>
                <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  HUB
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-medium">Atendimento & CRM</p>
            </div>
          </div>

          {/* Menu de Navegação em Português */}
          <nav className="p-3 space-y-1">
            <p className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Menu Principal
            </p>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path || (item.path === '/atendimento' && location.pathname === '/');
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive: navActive }) => {
                    const active = navActive || (item.path === '/atendimento' && location.pathname === '/');
                    return `flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold transition-all duration-150 ${
                      active
                        ? 'bg-amber-400/15 text-amber-300 border border-amber-400/35 shadow-sm font-bold'
                        : 'text-slate-400 border border-transparent hover:text-slate-100 hover:bg-[#263138]'
                    }`;
                  }}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    <span>{item.label}</span>
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
        <div className="p-3 border-t border-[#344047] bg-[#151e23]">
          
          {/* Status WhatsApp (Evolution API em Tempo Real) */}
          <div className="mb-3 p-2.5 rounded-lg bg-[#20292f] border border-[#344047] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-400' : connectionStatus === 'connecting' ? 'bg-amber-400' : 'bg-red-400'} opacity-75`}></span>
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connectionStatus === 'connected' ? 'bg-emerald-500' : connectionStatus === 'connecting' ? 'bg-amber-400' : 'bg-red-500'}`}></span>
              </span>
              <span className={`text-xs font-semibold ${connectionStatus === 'connected' ? 'text-zinc-300' : connectionStatus === 'connecting' ? 'text-amber-300' : 'text-red-300'}`}>
                {connectionStatus === 'connected' ? 'WhatsApp Conectado' : connectionStatus === 'connecting' ? 'Reconectando WhatsApp' : 'WhatsApp Desconectado'}
              </span>
            </div>
            {connectionStatus === 'connected' ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <WifiOff className={`w-3.5 h-3.5 ${connectionStatus === 'connecting' ? 'text-amber-400 animate-pulse' : 'text-red-400'}`} />
            )}
          </div>

          {/* Card Atendente */}
          <div className="flex items-center justify-between p-2 rounded-lg hover:bg-[#263138] transition-colors">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <img 
                  src={`https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser?.name || 'Usuário')}&background=EEBB2C&color=000`}
                  alt={currentUser?.name || 'Usuário'}
                  className="w-9 h-9 rounded-full object-cover border border-amber-400/40" 
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=Leo+Vitorino&background=EEBB2C&color=000';
                  }}
                />
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-zinc-950"></span>
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-bold text-zinc-100 truncate flex items-center gap-1">
                  {currentUser?.name}
                  <ShieldCheck className="w-3 h-3 text-amber-400 inline" />
                </p>
                <p className="text-[11px] text-zinc-400 truncate capitalize">{currentUser?.role}</p>
              </div>
            </div>
            <button 
              onClick={() => void logout()}
              className="text-zinc-500 hover:text-red-400 p-1.5 rounded-md hover:bg-zinc-800/50 transition-colors"
              title="Sair da Plataforma"
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
