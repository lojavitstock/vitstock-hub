import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Send, 
  Paperclip, 
  Mic, 
  MoreVertical, 
  CheckCheck, 
  Tag as TagIcon, 
  UserCheck, 
  CheckCircle, 
  Lock, 
  Mail, 
  Zap, 
  Image as ImageIcon,
  Kanban,
  RefreshCw,
  MessageSquare,
  Plus,
  Phone
} from 'lucide-react';
import { mockConversations } from '../services/mockData';
import { Conversation, Message } from '../types';
import { EvolutionApiService } from '../services/evolutionApi';
import { supabase } from '../services/supabase';

export const AtendimentoPage: React.FC = () => {
  const instanceName = import.meta.env.VITE_EVOLUTION_INSTANCE_NAME || 'vitstock_atendimento';
  const isMock = import.meta.env.VITE_USE_MOCK_DATA === 'true';

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>('');
  const [filterTab, setFilterTab] = useState<'open' | 'pending' | 'resolved'>('open');
  const [inputText, setInputText] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);

  // Estado para Nova Conversa por Telefone
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatNumber, setNewChatNumber] = useState('');
  const [newChatName, setNewChatName] = useState('');

  // Mensagens do chat ativo
  const [messages, setMessages] = useState<Message[]>([]);


  // Carregar conversas ao iniciar e manter atualizado a cada 4 segundos
  useEffect(() => {
    loadChats();

    if (isMock) return;

    const interval = setInterval(() => {
      loadChats(false); // Atualização silenciosa em segundo plano
    }, 4000);

    return () => clearInterval(interval);
  }, [isMock]);

  // Carregar mensagens quando trocar de conversa e manter sincronizado a cada 3 segundos
  useEffect(() => {
    if (!activeConvId || isMock) return;

    const fetchConvMessages = async () => {
      const realMsgs = await EvolutionApiService.fetchMessages(instanceName, activeConvId);
      setMessages(realMsgs);
    };

    fetchConvMessages();

    const interval = setInterval(fetchConvMessages, 3000);
    return () => clearInterval(interval);
  }, [activeConvId, isMock, instanceName]);

  const loadChats = async (showLoading = true) => {
    if (showLoading) setLoadingChats(true);
    if (isMock) {
      setConversations(mockConversations);
      setActiveConvId(mockConversations[0]?.id || '');
    } else {
      const realChats = await EvolutionApiService.fetchRealChats(instanceName);
      if (realChats.length > 0) {
        setConversations(realChats);
        // Define a primeira conversa ativa se ainda não houver nenhuma selecionada
        setActiveConvId(prev => prev || realChats[0].id);
      } else {
        setConversations([]);
        setMessages([]);
      }
    }
    if (showLoading) setLoadingChats(false);
  };


  const activeConv = conversations.find(c => c.id === activeConvId);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConv) return;

    const newMsgText = inputText;
    setInputText('');

    const newMsg: Message = {
      id: `msg-${Date.now()}`,
      conversationId: activeConv.id,
      sender: 'attendant',
      senderName: 'Leo Vitorino',
      content: newMsgText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sent',
      isInternalNote
    };

    setMessages(prev => [...prev, newMsg]);

    // Se NÃO for nota interna e NÃO for mock, envia mensagem real no WhatsApp via Evolution API!
    if (!isInternalNote && !isMock) {
      await EvolutionApiService.sendTextMessage(instanceName, activeConv.contact.phone, newMsgText);
    }

    // Atualiza última mensagem na lista
    setConversations(prev => prev.map(c => c.id === activeConv.id ? {
      ...c,
      lastMessage: isInternalNote ? `[Nota Interna]: ${newMsgText}` : newMsgText,
      lastMessageTimestamp: 'Agora',
      unreadCount: 0
    } : c));
  };

  const handleStartNewChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatNumber.trim()) return;

    const cleanNum = newChatNumber.replace(/\D/g, '');
    const jid = `${cleanNum}@s.whatsapp.net`;
    const contactName = newChatName.trim() || `+${cleanNum}`;

    const newConv: Conversation = {
      id: jid,
      contact: {
        id: jid,
        name: contactName,
        phone: `+${cleanNum}`,
        avatar: '',
        tags: [{ id: 't-new', name: 'WhatsApp', color: '#10B981' }],
        createdAt: new Date().toISOString().split('T')[0]
      },
      lastMessage: 'Nova conversa iniciada',
      lastMessageTimestamp: 'Agora',
      unreadCount: 0,
      status: 'open',
      department: 'Atendimento Geral'
    };

    setConversations(prev => [newConv, ...prev]);
    setActiveConvId(jid);
    setMessages([]);
    setShowNewChatModal(false);
    setNewChatNumber('');
    setNewChatName('');
  };

  const insertQuickReply = (text: string) => {
    setInputText(text);
    setQuickReplyOpen(false);
  };

  return (
    <div className="flex h-full w-full bg-zinc-950 overflow-hidden text-zinc-100 font-overpass relative">
      
      {/* Modal para Nova Conversa Directa */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#121215] border border-zinc-800 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
              <Phone className="w-5 h-5 text-amber-400" /> Nova Conversa WhatsApp
            </h2>
            <form onSubmit={handleStartNewChat} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">Número do WhatsApp (com DDD)</label>
                <input 
                  type="text" 
                  placeholder="Ex: 5521999998888"
                  value={newChatNumber}
                  onChange={e => setNewChatNumber(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-400"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">Nome do Contato (Opcional)</label>
                <input 
                  type="text" 
                  placeholder="Ex: João da Silva"
                  value={newChatName}
                  onChange={e => setNewChatName(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button 
                  type="button" 
                  onClick={() => setShowNewChatModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-xs font-bold text-zinc-400 hover:text-zinc-200"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-400 text-zinc-950 text-xs font-extrabold hover:bg-amber-300"
                >
                  Iniciar Chat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Coluna 1: Lista de Conversas (Inbox) */}
      <div className="w-80 border-r border-zinc-800/80 flex flex-col bg-[#0A0A0C] flex-shrink-0">
        
        {/* Topo do Inbox: Busca e Filtros */}
        <div className="p-4 border-b border-zinc-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-extrabold tracking-tight text-zinc-100 flex items-center gap-2">
              Atendimento
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/20 font-bold">
                {conversations.length} conversas
              </span>
            </h1>
            <div className="flex items-center gap-1.5">
              <button 
                onClick={() => setShowNewChatModal(true)}
                className="p-1.5 rounded-lg bg-amber-400 text-zinc-950 hover:bg-amber-300 transition-colors font-bold"
                title="Nova Conversa"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button 
                onClick={() => loadChats(true)} 
                className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-amber-400 transition-colors"
                title="Sincronizar Mensagens"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingChats ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Campo de Busca */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Buscar cliente, telefone..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-400 transition-colors"
            />
          </div>

          {/* Abas de Status */}
          <div className="flex rounded-lg bg-zinc-900 p-1 border border-zinc-800">
            {(['open', 'pending', 'resolved'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={`flex-1 py-1.5 text-xs font-bold rounded-md capitalize transition-all ${
                  filterTab === tab 
                    ? 'bg-amber-400 text-zinc-950 shadow-sm' 
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab === 'open' ? 'Abertos' : tab === 'pending' ? 'Pendentes' : 'Resolvidos'}
              </button>
            ))}
          </div>
        </div>

        {/* Lista de Conversas com Scroll */}
        <div className="flex-1 overflow-y-auto divide-y divide-zinc-900">
          {conversations.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <MessageSquare className="w-8 h-8 text-zinc-600 mx-auto" />
              <p className="text-xs font-bold text-zinc-400">Nenhuma conversa encontrada</p>
              <p className="text-[11px] text-zinc-500">Assim que um cliente enviar mensagem no seu WhatsApp, ela aparecerá aqui em tempo real.</p>
            </div>
          ) : (
            conversations
              .filter(c => c.status === filterTab || filterTab === 'open')
              .map(conv => {
                const isSelected = conv.id === activeConvId;
                return (
                  <div
                    key={conv.id}
                    onClick={() => {
                      setActiveConvId(conv.id);
                      setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, unreadCount: 0 } : c));
                    }}
                    className={`p-3.5 cursor-pointer transition-colors relative flex items-start gap-3 ${
                      isSelected ? 'bg-zinc-900/90 border-l-4 border-amber-400' : 'hover:bg-zinc-900/40'
                    }`}
                  >
                    <div className="relative flex-shrink-0">
                      <img 
                        src={conv.contact.avatar} 
                        alt={conv.contact.name} 
                        className="w-11 h-11 rounded-full object-cover border border-zinc-700"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(conv.contact.name)}&background=EEBB2C&color=000`;
                        }}
                      />
                      {conv.unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 w-5 h-5 bg-amber-400 text-zinc-950 font-extrabold text-[10px] rounded-full flex items-center justify-center border-2 border-zinc-950">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-bold text-zinc-100 truncate">{conv.contact.name}</p>
                        <span className="text-[10px] font-semibold text-zinc-500">{conv.lastMessageTimestamp}</span>
                      </div>

                      <p className="text-xs text-zinc-400 truncate mb-1.5">{conv.lastMessage}</p>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                          {conv.department}
                        </span>
                        {conv.contact.tags.map(tag => (
                          <span 
                            key={tag.id}
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </div>

      {/* Coluna 2: Chat Principal (Bate-Papo Central) */}
      <div className="flex-1 flex flex-col bg-zinc-950 overflow-hidden">
        {activeConv ? (
          <>
            {/* Cabeçalho do Chat */}
            <div className="h-16 px-5 border-b border-zinc-800/80 bg-[#0C0C0E] flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <img 
                  src={activeConv.contact.avatar} 
                  alt={activeConv.contact.name} 
                  className="w-10 h-10 rounded-full object-cover border border-amber-400/40"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(activeConv.contact.name)}&background=EEBB2C&color=000`;
                  }}
                />
                <div>
                  <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    {activeConv.contact.name}
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold">
                      WhatsApp Conectado
                    </span>
                  </h2>
                  <p className="text-xs text-zinc-400 font-mono">{activeConv.contact.phone}</p>
                </div>
              </div>

              {/* Ações Rápidas do Atendimento */}
              <div className="flex items-center gap-2">
                <button className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500 hover:text-zinc-950 transition-all flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Resolver Conversa
                </button>
                <button className="p-2 rounded-lg text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Mensagens com Scroll */}
            <div className="flex-1 p-5 overflow-y-auto space-y-4 bg-zinc-950/60">
              <div className="flex justify-center my-2">
                <span className="text-[10px] font-bold px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-500">
                  Atendimento em tempo real via Evolution API
                </span>
              </div>

              {messages.map(msg => {
                const isMe = msg.sender === 'attendant';
                const isNote = msg.isInternalNote;

                if (isNote) {
                  return (
                    <div key={msg.id} className="flex justify-center my-2 animate-fade-in">
                      <div className="max-w-xl w-full p-3 rounded-lg bg-amber-400/10 border border-amber-400/40 text-amber-300 text-xs">
                        <div className="flex items-center gap-1.5 font-bold mb-1 text-amber-400">
                          <Lock className="w-3.5 h-3.5" />
                          <span>Nota Interna ({msg.senderName})</span>
                          <span className="text-[10px] opacity-70 ml-auto">{msg.timestamp}</span>
                        </div>
                        <p>{msg.content}</p>
                        <span className="text-[9px] font-semibold text-amber-400/70 block mt-1">
                          🔒 Invisível para o cliente
                        </span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div 
                    key={msg.id} 
                    className={`flex gap-3 max-w-xl animate-fade-in ${isMe ? 'ml-auto flex-row-reverse' : ''}`}
                  >
                    {!isMe && (
                      <img 
                        src={activeConv.contact.avatar} 
                        alt={activeConv.contact.name} 
                        className="w-8 h-8 rounded-full object-cover border border-zinc-800 flex-shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(activeConv.contact.name)}&background=27272A&color=FFF`;
                        }}
                      />
                    )}
                    <div>
                      <div className={`p-3.5 rounded-2xl text-xs leading-relaxed space-y-2 ${
                        isMe 
                          ? 'bg-amber-400 text-zinc-950 font-medium rounded-tr-none shadow-[0_2px_10px_rgba(238,187,44,0.15)]' 
                          : 'bg-zinc-900 text-zinc-100 border border-zinc-800 rounded-tl-none'
                      }`}>
                        {isMe && <p className="text-[10px] font-bold text-zinc-900/70 mb-1">{msg.senderName}</p>}

                        {/* Renderização de Imagem */}
                        {msg.mediaType === 'image' && msg.mediaUrl && (
                          <div className="rounded-xl overflow-hidden max-w-xs mb-2 border border-black/10">
                            <img 
                              src={msg.mediaUrl} 
                              alt="Imagem recebida" 
                              className="w-full h-auto object-cover max-h-64 rounded-lg cursor-pointer hover:scale-105 transition-transform"
                              onClick={() => window.open(msg.mediaUrl, '_blank')}
                            />
                          </div>
                        )}

                        {/* Renderização de Áudio */}
                        {msg.mediaType === 'audio' && msg.mediaUrl && (
                          <div className="flex items-center gap-2 p-1.5 rounded-xl bg-black/10 my-1">
                            <audio 
                              controls 
                              src={msg.mediaUrl} 
                              className="w-full max-w-xs h-8 accent-amber-400"
                            />
                          </div>
                        )}

                        {/* Renderização de Documento */}
                        {msg.mediaType === 'document' && msg.mediaUrl && (
                          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-black/10 my-1 border border-white/10">
                            <Paperclip className="w-4 h-4 flex-shrink-0" />
                            <span className="truncate flex-1 font-bold">{msg.content}</span>
                            <a 
                              href={msg.mediaUrl} 
                              target="_blank" 
                              rel="noreferrer"
                              className="px-2 py-1 rounded bg-amber-400/20 text-amber-300 font-bold hover:bg-amber-400 hover:text-zinc-950 transition-colors"
                            >
                              Baixar
                            </a>
                          </div>
                        )}

                        {/* Texto da Mensagem */}
                        {msg.content && msg.content !== '[Imagem]' && msg.content !== '[Mensagem de Áudio]' && (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        )}
                      </div>
                      <div className={`flex items-center gap-1 mt-1 text-[10px] text-zinc-500 ${isMe ? 'justify-end' : ''}`}>
                        <span>{msg.timestamp}</span>
                        {isMe && <CheckCheck className="w-3.5 h-3.5 text-amber-500" />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Caixas de Resposta Rápida (Pop-over) */}
            {quickReplyOpen && (
              <div className="mx-5 p-3 rounded-lg bg-zinc-900 border border-amber-400/30 shadow-2xl space-y-2 animate-fade-in">
                <div className="flex items-center justify-between text-xs font-bold text-amber-400">
                  <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> Respostas Rápidas</span>
                  <button onClick={() => setQuickReplyOpen(false)} className="text-zinc-500 hover:text-zinc-300">✕</button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button 
                    onClick={() => insertQuickReply('Segue a proposta comercial para o lote com 5% de desconto no PIX: R$ 58.995,00.')}
                    className="p-2 text-left rounded bg-zinc-800/80 hover:bg-amber-400/20 hover:text-amber-300 text-zinc-300 border border-zinc-700/60"
                  >
                    <span className="font-bold block text-amber-400">/proposta</span> Proposta Comercial PIX
                  </button>
                  <button 
                    onClick={() => insertQuickReply('O prazo de entrega para Curitiba é de 2 a 3 dias úteis após a confirmação do pagamento.')}
                    className="p-2 text-left rounded bg-zinc-800/80 hover:bg-amber-400/20 hover:text-amber-300 text-zinc-300 border border-zinc-700/60"
                  >
                    <span className="font-bold block text-amber-400">/frete</span> Prazo de Entrega
                  </button>
                </div>
              </div>
            )}

            {/* Input de Envio de Mensagem */}
            <form onSubmit={handleSendMessage} className="p-4 bg-[#0C0C0E] border-t border-zinc-800/80">
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setIsInternalNote(false)}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                    !isInternalNote 
                      ? 'bg-amber-400 text-zinc-950 shadow-sm' 
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  💬 Mensagem WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => setIsInternalNote(true)}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1 ${
                    isInternalNote 
                      ? 'bg-amber-400/20 text-amber-400 border border-amber-400/40' 
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  🔒 Nota Interna (Privada)
                </button>

                <button
                  type="button"
                  onClick={() => setQuickReplyOpen(!quickReplyOpen)}
                  className="ml-auto text-xs font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1 bg-amber-400/10 px-2.5 py-1 rounded border border-amber-400/20"
                >
                  <Zap className="w-3.5 h-3.5" /> Resposta Rápida
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button type="button" className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-amber-400 transition-colors">
                  <Paperclip className="w-4 h-4" />
                </button>

                <input 
                  type="text" 
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={isInternalNote ? "Digite uma nota interna para a equipe..." : "Digite sua mensagem para o WhatsApp..."}
                  className={`flex-1 bg-zinc-900 border text-xs text-zinc-100 placeholder-zinc-500 rounded-lg px-4 py-3 focus:outline-none transition-colors ${
                    isInternalNote 
                      ? 'border-amber-400/50 bg-amber-400/5 focus:border-amber-400' 
                      : 'border-zinc-800 focus:border-amber-400'
                  }`}
                />

                <button 
                  type="submit"
                  className={`p-3 rounded-lg font-bold flex items-center justify-center transition-all ${
                    isInternalNote 
                      ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400' 
                      : 'bg-amber-400 text-zinc-950 hover:bg-amber-300 shadow-[0_0_12px_rgba(238,187,44,0.3)]'
                  }`}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-zinc-500">
            <MessageSquare className="w-12 h-12 mb-3 text-zinc-700 animate-pulse" />
            <h3 className="text-sm font-bold text-zinc-300 mb-1">Seu WhatsApp está 100% Conectado!</h3>
            <p className="text-xs max-w-sm text-zinc-500">
              As mensagens enviadas para o seu número aparecerão aqui automaticamente.
            </p>
          </div>
        )}
      </div>

      {/* Coluna 3: Ficha CRM */}
      {activeConv && (
        <div className="w-72 border-l border-zinc-800/80 bg-[#0A0A0C] p-5 flex flex-col justify-between flex-shrink-0 overflow-y-auto">
          <div>
            <div className="text-center pb-5 border-b border-zinc-800/80">
              <img 
                src={activeConv.contact.avatar} 
                alt={activeConv.contact.name} 
                className="w-16 h-16 rounded-full object-cover mx-auto mb-3 border-2 border-amber-400"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(activeConv.contact.name)}&background=EEBB2C&color=000`;
                }}
              />
              <h3 className="text-sm font-extrabold text-zinc-100">{activeConv.contact.name}</h3>
              <p className="text-xs text-amber-400 font-mono mt-0.5">{activeConv.contact.phone}</p>
            </div>

            <div className="py-4 border-b border-zinc-800/80">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-2">
                Etiquetas
              </span>
              <div className="flex flex-wrap gap-1.5">
                {activeConv.contact.tags.map(tag => (
                  <span 
                    key={tag.id}
                    className="text-xs font-bold px-2 py-1 rounded"
                    style={{ backgroundColor: `${tag.color}25`, color: tag.color, border: `1px solid ${tag.color}50` }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-4">
            <button className="w-full btn-primary text-xs justify-center py-2.5">
              <Kanban className="w-4 h-4" /> Criar Negócio no Funil
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
