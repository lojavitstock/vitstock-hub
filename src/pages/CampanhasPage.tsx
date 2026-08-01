import React, { useState } from 'react';
import { Megaphone, Plus, Calendar, Clock, Image as ImageIcon, CheckCircle, Play, Pause, Send, Users } from 'lucide-react';
import { mockCampaigns } from '../services/mockData';
import { Campaign } from '../types';

export const CampanhasPage: React.FC = () => {
  const [campaigns, setCampaigns] = useState<Campaign[]>(mockCampaigns);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Form State
  const [newCampaign, setNewCampaign] = useState({
    title: '',
    groupName: '🚗 Vitstock - Grupo de Ofertas VIP',
    scheduleTime: '09:00',
    caption: '',
    imageUrl: '/VITSTOCK®/PRINCIPAL/1.png',
    days: ['Segunda', 'Quarta', 'Sexta']
  });

  const toggleCampaign = (id: string) => {
    setCampaigns(prev => prev.map(c => c.id === id ? { ...c, isActive: !c.isActive } : c));
  };

  const handleCreateCampaign = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCampaign.title || !newCampaign.caption) return;

    const campaign: Campaign = {
      id: `camp-${Date.now()}`,
      title: newCampaign.title,
      targetType: 'group',
      targetGroupName: newCampaign.groupName,
      scheduleTime: newCampaign.scheduleTime,
      scheduleDays: newCampaign.days,
      caption: newCampaign.caption,
      imageUrl: newCampaign.imageUrl,
      isActive: true
    };

    setCampaigns(prev => [campaign, ...prev]);
    setIsModalOpen(false);
    showToast('Campanha de Grupo agendada com sucesso!');
  };

  const triggerTestSend = (campaign: Campaign) => {
    showToast(`🚀 Disparo de teste enviado via Evolution API para "${campaign.targetGroupName}"!`);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  return (
    <div className="flex-1 h-full p-6 overflow-y-auto bg-zinc-950 font-overpass">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-amber-400 text-zinc-950 px-4 py-3 rounded-xl font-bold shadow-2xl z-50 animate-fade-in flex items-center gap-2 border border-zinc-900">
          <CheckCircle className="w-5 h-5 text-zinc-950" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-extrabold text-zinc-100 flex items-center gap-2">
            Automação de Campanhas & Disparos em Grupos
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/20 font-bold">
              {campaigns.length} agendadas
            </span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Publique imagens e ofertas automaticamente em grupos do WhatsApp sempre nos mesmos horários da semana
          </p>
        </div>

        <button 
          onClick={() => setIsModalOpen(true)}
          className="btn-primary text-xs"
        >
          <Plus className="w-4 h-4" /> Nova Campanha Recorrente
        </button>
      </div>

      {/* Cards de Campanhas */}
      <div className="grid grid-cols-2 gap-6">
        {campaigns.map(camp => (
          <div 
            key={camp.id} 
            className="p-5 rounded-2xl bg-[#0C0C0E] border border-zinc-800/80 hover:border-amber-400/50 transition-all shadow-xl flex flex-col justify-between space-y-4"
          >
            <div>
              {/* Header do Card */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-sm font-extrabold text-zinc-100 flex items-center gap-2">
                    {camp.title}
                  </h3>
                  <span className="text-xs text-amber-400 font-bold flex items-center gap-1 mt-1">
                    <Users className="w-3.5 h-3.5" /> {camp.targetGroupName}
                  </span>
                </div>

                <button 
                  onClick={() => toggleCampaign(camp.id)}
                  className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all ${
                    camp.isActive 
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' 
                      : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                  }`}
                >
                  {camp.isActive ? <Play className="w-3 h-3 fill-emerald-400" /> : <Pause className="w-3 h-3" />}
                  {camp.isActive ? 'Ativa' : 'Pausada'}
                </button>
              </div>

              {/* Mídia & Legenda */}
              <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800/80 flex gap-4">
                {camp.imageUrl && (
                  <img 
                    src={camp.imageUrl} 
                    alt="Banner da Campanha" 
                    className="w-20 h-20 rounded-lg object-cover border border-zinc-800 flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/VITSTOCK®/PRINCIPAL/1.png';
                    }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-zinc-300 font-medium line-clamp-3 leading-relaxed whitespace-pre-wrap">
                    {camp.caption}
                  </p>
                </div>
              </div>
            </div>

            {/* Rodapé: Horário e Dias de Envio */}
            <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Horário: <strong className="text-zinc-100 font-mono">{camp.scheduleTime}</strong></span>
                </div>
                <div className="flex items-center gap-1 text-[10px]">
                  {['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'].map(d => (
                    <span 
                      key={d}
                      className={`px-1.5 py-0.5 rounded font-bold ${
                        camp.scheduleDays.includes(d) 
                          ? 'bg-amber-400 text-zinc-950' 
                          : 'bg-zinc-900 text-zinc-600'
                      }`}
                    >
                      {d.substring(0, 3)}
                    </span>
                  ))}
                </div>
              </div>

              <button 
                onClick={() => triggerTestSend(camp)}
                className="btn-secondary text-xs"
              >
                <Send className="w-3.5 h-3.5 text-amber-400" /> Disparar Agora
              </button>
            </div>

          </div>
        ))}
      </div>

      {/* Modal Criar Campanha */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[#0C0C0E] border border-zinc-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold text-zinc-100">Criar Campanha Recorrente em Grupo</h2>
            <form onSubmit={handleCreateCampaign} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-zinc-400 block mb-1">Título da Campanha</label>
                <input 
                  type="text" 
                  required
                  value={newCampaign.title}
                  onChange={e => setNewCampaign({...newCampaign, title: e.target.value})}
                  placeholder="Ex: Envio Diário de Banners com Ofertas"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-400 block mb-1">Grupo Alvo do WhatsApp</label>
                <select 
                  value={newCampaign.groupName}
                  onChange={e => setNewCampaign({...newCampaign, groupName: e.target.value})}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-400"
                >
                  <option value="🚗 Vitstock - Grupo de Ofertas VIP">🚗 Vitstock - Grupo de Ofertas VIP</option>
                  <option value="🏍️ Vitstock - Pneus & Rodas de Moto">🏍️ Vitstock - Pneus & Rodas de Moto</option>
                  <option value="🏢 Vitstock - Atacado & Revenda">🏢 Vitstock - Atacado & Revenda</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-zinc-400 block mb-1">Horário do Disparo (HH:MM)</label>
                  <input 
                    type="time" 
                    required
                    value={newCampaign.scheduleTime}
                    onChange={e => setNewCampaign({...newCampaign, scheduleTime: e.target.value})}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-400 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-400 block mb-1">Caminho da Imagem</label>
                  <input 
                    type="text" 
                    value={newCampaign.imageUrl}
                    onChange={e => setNewCampaign({...newCampaign, imageUrl: e.target.value})}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-400 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-400 block mb-1">Mensagem Legenda</label>
                <textarea 
                  rows={3}
                  required
                  value={newCampaign.caption}
                  onChange={e => setNewCampaign({...newCampaign, caption: e.target.value})}
                  placeholder="Digite a mensagem formatada para o grupo..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="btn-secondary text-xs"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="btn-primary text-xs"
                >
                  Salvar Campanha
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
