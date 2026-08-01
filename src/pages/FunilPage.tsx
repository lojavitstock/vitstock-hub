import React, { useState } from 'react';
import { Kanban, Plus, DollarSign, MessageSquare, ArrowRight, Tag as TagIcon, CheckCircle2 } from 'lucide-react';
import { mockDeals } from '../services/mockData';
import { Deal } from '../types';
import { useNavigate } from 'react-router-dom';

export const FunilPage: React.FC = () => {
  const navigate = useNavigate();
  const [deals, setDeals] = useState<Deal[]>(mockDeals);

  const stages = [
    { id: 'novo', title: 'Novos Leads', color: '#EC4899' },
    { id: 'negociacao', title: 'Em Negociação', color: '#EEBB2C' },
    { id: 'proposta', title: 'Proposta Enviada', color: '#3B82F6' },
    { id: 'fechado', title: 'Venda Fechada', color: '#10B981' }
  ] as const;

  const moveStage = (dealId: string, nextStage: Deal['stage']) => {
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: nextStage } : d));
  };

  const calculateTotal = (stageId: string) => {
    return deals
      .filter(d => d.stage === stageId)
      .reduce((acc, curr) => acc + curr.value, 0)
      .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  return (
    <div className="flex-1 h-full p-6 overflow-x-auto bg-zinc-950 font-overpass flex flex-col">
      
      {/* Header do Funil */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-800 flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-zinc-100 flex items-center gap-2">
            Funil CRM de Vendas
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/20 font-bold">
              {deals.length} oportunidades
            </span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">Gerencie a evolução dos seus negócios integrados ao WhatsApp</p>
        </div>

        <button className="btn-primary text-xs">
          <Plus className="w-4 h-4" /> Nova Oportunidade
        </button>
      </div>

      {/* Grid Kanban de Colunas */}
      <div className="flex-1 grid grid-cols-4 gap-4 min-w-[1000px] overflow-y-hidden">
        {stages.map(stage => {
          const stageDeals = deals.filter(d => d.stage === stage.id);
          return (
            <div key={stage.id} className="bg-[#0C0C0E] border border-zinc-800/80 rounded-xl p-3.5 flex flex-col h-full">
              
              {/* Header da Coluna */}
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-800/80">
                <div className="flex items-center gap-2">
                  <span 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: stage.color, boxShadow: `0 0 10px ${stage.color}60` }}
                  />
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-200">{stage.title}</h3>
                </div>
                <span className="text-xs font-bold text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded-full border border-zinc-800">
                  {stageDeals.length}
                </span>
              </div>

              {/* Totalizador Financeiro */}
              <div className="mb-3 p-2 rounded-lg bg-zinc-900/60 border border-zinc-800 text-center">
                <span className="text-[10px] text-zinc-500 font-bold block uppercase">Total Previsto</span>
                <span className="text-xs font-extrabold text-amber-400">{calculateTotal(stage.id)}</span>
              </div>

              {/* Lista de Cards da Coluna */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {stageDeals.map(deal => (
                  <div 
                    key={deal.id} 
                    className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-amber-400/50 transition-all shadow-lg space-y-2.5 group"
                  >
                    <div className="flex items-start justify-between">
                      <h4 className="text-xs font-extrabold text-zinc-100 group-hover:text-amber-400 transition-colors">
                        {deal.title}
                      </h4>
                    </div>

                    <div className="text-xs text-zinc-400 font-medium">
                      <p className="font-bold text-zinc-200">{deal.contactName}</p>
                      <p className="font-mono text-[11px] text-amber-400">{deal.contactPhone}</p>
                    </div>

                    {/* Valor do Negócio */}
                    <div className="p-2 rounded bg-zinc-950/80 border border-zinc-800/60 flex items-center justify-between text-xs font-bold text-emerald-400">
                      <span>Valor:</span>
                      <span>{deal.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                    </div>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1">
                      {deal.tags.map(tag => (
                        <span 
                          key={tag.id}
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>

                    {/* Botões de Ação do Card */}
                    <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
                      <button 
                        onClick={() => navigate('/atendimento')}
                        className="text-xs font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1"
                      >
                        <MessageSquare className="w-3.5 h-3.5" /> Abrir Chat
                      </button>

                      {/* Avançar Estágio */}
                      {stage.id !== 'fechado' && (
                        <button 
                          onClick={() => {
                            const nextStage = stage.id === 'novo' ? 'negociacao' : stage.id === 'negociacao' ? 'proposta' : 'fechado';
                            moveStage(deal.id, nextStage);
                          }}
                          className="text-[11px] font-bold px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-amber-400 hover:text-zinc-950 transition-colors flex items-center gap-1"
                        >
                          Avançar <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

            </div>
          );
        })}
      </div>

    </div>
  );
};
