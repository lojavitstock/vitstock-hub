import React from 'react';
import { Bell, Download, Smartphone } from 'lucide-react';
import { useNotifications } from '../notifications/NotificationProvider';

export const ApplicationSettings: React.FC = () => {
  const { permissionState, requestNotificationPermission, installState, installApp } = useNotifications();

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h3 className="text-lg font-extrabold text-zinc-100">Aplicativo</h3>
        <p className="mt-1 text-sm text-zinc-400">Instalação e avisos de novas mensagens neste navegador.</p>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-[#0C0C0E] p-5" aria-labelledby="application-notifications-heading">
        <div className="flex items-start gap-3">
          <span className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-2 text-amber-300"><Bell className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h4 id="application-notifications-heading" className="font-bold text-zinc-100">Notificações</h4>
            <p className="mt-1 text-sm text-zinc-400">Receba um aviso do sistema quando uma nova mensagem chegar com o Hub minimizado.</p>
            <div className="mt-4" aria-live="polite">
              {permissionState === 'default' && (
                <button type="button" onClick={() => void requestNotificationPermission()} className="btn-primary text-sm">
                  <Bell className="h-4 w-4" /> Ativar notificações
                </button>
              )}
              {permissionState === 'granted' && <p role="status" className="text-sm font-semibold text-emerald-300">Notificações ativadas</p>}
              {permissionState === 'denied' && <p role="status" className="text-sm font-semibold text-amber-300">Notificações bloqueadas no navegador</p>}
              {permissionState === 'unsupported' && <p role="status" className="text-sm text-zinc-400">Este navegador não oferece suporte</p>}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-[#0C0C0E] p-5" aria-labelledby="application-install-heading">
        <div className="flex items-start gap-3">
          <span className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-2 text-amber-300"><Smartphone className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h4 id="application-install-heading" className="font-bold text-zinc-100">Instalação</h4>
            <p className="mt-1 text-sm text-zinc-400">Use o Vitstock Hub em uma janela própria do Chrome.</p>
            <div className="mt-4" aria-live="polite">
              {installState === 'installed' && <p role="status" className="text-sm font-semibold text-emerald-300">Vitstock Hub instalado</p>}
              {installState === 'available' && (
                <button type="button" onClick={() => void installApp()} className="btn-primary text-sm">
                  <Download className="h-4 w-4" /> Instalar Vitstock Hub
                </button>
              )}
              {installState === 'unavailable' && <p className="text-sm text-zinc-500">A instalação não está disponível neste navegador agora.</p>}
            </div>
          </div>
        </div>
      </section>

      <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs leading-5 text-zinc-500">
        Notificações de novas mensagens dependem do Hub aberto ou minimizado e da conexão em tempo real. Com o aplicativo totalmente fechado, elas não são garantidas nesta fase.
      </p>
    </div>
  );
};
