import React, { useState, useEffect } from 'react';
import { Settings, Users, Shield, Zap, Layers, Plus, Check, Loader2 } from 'lucide-react';
import { Attendant } from '../types';
import { supabase } from '../services/supabase';

export const ConfiguracoesPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'attendants' | 'departments' | 'quickReplies'>('attendants');
  const [attendants, setAttendants] = useState<Attendant[]>([]);
  const [loadingAttendants, setLoadingAttendants] = useState(false);

  useEffect(() => {
    if (activeTab === 'attendants') {
      fetchAttendants();
    }
  }, [activeTab]);

  const fetchAttendants = async () => {
    setLoadingAttendants(true);
    try {
      const { data, error } = await supabase.from('profiles').select('*');
      if (!error && data) {
        setAttendants(data.map(p => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar || '',
          role: p.role,
          online: p.online || false
        })));
      }
    } catch (err) {
      console.error('Erro ao carregar atendentes:', err);
    } finally {
      setLoadingAttendants(false);
    }
  };

  return (
    <div className="flex-1 h-full p-6 overflow-y-auto bg-zinc-950 font-overpass">
      
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-extrabold text-zinc-100 flex items-center gap-2">
            Configurações da Plataforma
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Gerencie atendentes, setores de atendimento e atalhos de mensagens
          </p>
        </div>
      </div>

      {/* Navegação por Abas */}
      <div className="flex border-b border-zinc-800 mb-6 gap-6">
        {[
          { id: 'attendants', label: 'Equipe de Atendentes', icon: Users },
          { id: 'departments', label: 'Setores & Filas', icon: Layers },
          { id: 'quickReplies', label: 'Respostas Rápidas', icon: Zap }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-3 text-xs font-bold transition-all flex items-center gap-2 border-b-2 ${
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
      </div>

      {/* Conteúdo da Aba */}
      {activeTab === 'attendants' && (
        <div className="space-y-4 max-w-3xl">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-zinc-100">Atendentes Cadastrados</h3>
            <button className="btn-primary text-xs"><Plus className="w-4 h-4" /> Convidar Atendente</button>
          </div>

          <div className="bg-[#0C0C0E] border border-zinc-800 rounded-xl divide-y divide-zinc-900">
            {loadingAttendants ? (
              <div className="p-8 text-center text-zinc-500 text-xs flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-amber-400" /> Carregando atendentes do Supabase...
              </div>
            ) : attendants.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 text-xs">
                Nenhum atendente cadastrado no banco de dados ainda.
              </div>
            ) : (
              attendants.map(attendant => (
                <div key={attendant.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img 
                      src={attendant.avatar} 
                      alt={attendant.name} 
                      className="w-10 h-10 rounded-full object-cover border border-zinc-800"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(attendant.name)}&background=EEBB2C&color=000`;
                      }}
                    />
                    <div>
                      <h4 className="text-xs font-bold text-zinc-100">{attendant.name}</h4>
                      <span className="text-[11px] text-zinc-400 capitalize">{attendant.role}</span>
                    </div>
                  </div>

                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    attendant.online ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {attendant.online ? 'Online' : 'Offline'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'departments' && (
        <div className="space-y-4 max-w-3xl">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-zinc-100">Setores de Atendimento</h3>
            <button className="btn-primary text-xs"><Plus className="w-4 h-4" /> Criar Setor</button>
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
        <div className="space-y-4 max-w-3xl">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-zinc-100">Respostas Rápidas Configuradas</h3>
            <button className="btn-primary text-xs"><Plus className="w-4 h-4" /> Criar Atalho</button>
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
