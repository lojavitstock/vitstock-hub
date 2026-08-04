import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
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
  Phone,
  UserPlus,
  Pencil,
  Save,
  Play,
  Pause,
  Download,
  UserRound,
  ExternalLink,
  PhoneCall,
  Copy,
  X,
  Building2,
  Globe,
  MapPin,
  Megaphone,
  Archive
} from 'lucide-react';
import { mockConversations } from '../services/mockData';
import { ChatStatus, Conversation, Message } from '../types';
import { EvolutionApiService } from '../services/evolutionApi';
import { apiRequest } from '../services/api';
import { useAuth } from '../auth/AuthContext';

const ContactPhoto: React.FC<{
  name: string;
  avatar?: string;
  size?: 'small' | 'medium' | 'large';
  emphasized?: boolean;
}> = ({ name, avatar, size = 'medium', emphasized = false }) => {
  const sizeClass = size === 'small' ? 'w-8 h-8' : size === 'large' ? 'w-16 h-16' : 'w-11 h-11';
  const iconClass = size === 'small' ? 'w-4 h-4' : size === 'large' ? 'w-7 h-7' : 'w-5 h-5';
  return (
    <div className={`${sizeClass} relative rounded-full overflow-hidden flex-shrink-0 bg-[#2a343a] border ${emphasized ? 'border-amber-400/60' : 'border-[#46535a]'} flex items-center justify-center`} title={name}>
      <UserRound className={`${iconClass} text-slate-400`} />
      {avatar && (
        <img
          src={avatar}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
      )}
    </div>
  );
};

const InteractiveMessageContent: React.FC<{ msg: Message }> = ({ msg }) => {
  if (!msg.interactiveTitle && !msg.interactiveFooter && !msg.interactiveButtons?.length) return null;
  return (
    <div className="space-y-2">
      {msg.interactiveTitle && <p className="font-extrabold text-sm text-slate-50">{msg.interactiveTitle}</p>}
      {msg.interactiveFooter && <p className="text-[11px] text-slate-400">{msg.interactiveFooter}</p>}
      {msg.interactiveButtons?.map((button, index) => button.type === 'url' && button.url ? (
        <a key={`${button.label}-${index}`} href={button.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full px-3 py-2 mt-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 font-bold hover:bg-emerald-400/20">
          <ExternalLink className="w-4 h-4" /> {button.label}
        </a>
      ) : button.type === 'call' && button.value ? (
        <a key={`${button.label}-${index}`} href={`tel:${button.value}`} className="flex items-center justify-center gap-2 w-full px-3 py-2 mt-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 font-bold">
          <PhoneCall className="w-4 h-4" /> {button.label}
        </a>
      ) : button.type === 'copy' && button.value ? (
        <button key={`${button.label}-${index}`} type="button" onClick={() => void navigator.clipboard?.writeText(button.value || '')} className="flex items-center justify-center gap-2 w-full px-3 py-2 mt-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 font-bold">
          <Copy className="w-4 h-4" /> {button.label}
        </button>
      ) : (
        <button key={`${button.label}-${index}`} type="button" className="w-full px-3 py-2 mt-2 rounded-lg border border-slate-500/30 bg-white/5 text-slate-300 font-bold">{button.label}</button>
      ))}
    </div>
  );
};

const SpecialMessageContent: React.FC<{ msg: Message }> = ({ msg }) => {
  const metadata = msg.metadata;
  if (!metadata) return null;
  const trafficLabel = metadata.trafficSource === 'FB_Ads'
    ? 'Anúncio do Facebook ou Instagram'
    : metadata.trafficSource
      ? `Origem: ${metadata.trafficSource}`
      : '';
  return (
    <div className="space-y-2">
      {trafficLabel && (
        <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-2.5 text-emerald-100">
          <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-emerald-300">
            <Megaphone className="h-4 w-4" /> {trafficLabel}
          </div>
          {metadata.trafficTitle && <p className="mt-1 text-xs font-semibold text-slate-100">{metadata.trafficTitle}</p>}
          {metadata.trafficUrl && (
            <a href={metadata.trafficUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-300 hover:text-emerald-200">
              <ExternalLink className="h-3 w-3" /> Mostrar detalhes
            </a>
          )}
        </div>
      )}
      {metadata.contactCard && (
        <div className="flex items-center gap-2.5 rounded-xl border border-sky-300/20 bg-sky-400/10 p-2.5">
          <UserRound className="h-5 w-5 text-sky-300" />
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-slate-100">{metadata.contactCard.displayName}</p>
            {metadata.contactCard.phone && <p className="text-[11px] text-slate-300">{metadata.contactCard.phone}</p>}
          </div>
        </div>
      )}
      {metadata.location && (
        <a href={metadata.location.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 rounded-xl border border-amber-300/20 bg-amber-400/10 p-2.5 text-amber-100 hover:bg-amber-400/15">
          <MapPin className="h-5 w-5 text-amber-300" />
          <span className="text-xs font-bold">{metadata.location.name || 'Localização compartilhada'}{metadata.location.address ? `\n${metadata.location.address}` : ''}</span>
        </a>
      )}
      {metadata.systemLabel && (
        <div className="flex items-center gap-2 rounded-xl border border-slate-300/15 bg-black/20 p-2.5 text-xs font-bold text-slate-300">
          <PhoneCall className="h-4 w-4 text-amber-300" /> {metadata.systemLabel}
        </div>
      )}
    </div>
  );
};

const formatAudioTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
};

const conversationNeedsResponse = (conversation: Conversation) => (
  conversation.needsResponse
  ?? (conversation.status !== 'resolved' && !conversation.lastMessageFromMe && conversation.unreadCount > 0)
);

const isMediaPlaceholder = (message: Message) => {
  const content = message.content.trim().toLocaleLowerCase();
  if (message.mediaType === 'image') return content === '[imagem]' || content === '[image]';
  if (message.mediaType === 'video') return content === '[vídeo]' || content === '[video]';
  if (message.mediaType === 'document') return content === '[documento]' || content === '[document]';
  if (message.mediaType === 'audio') return content === '[mensagem de áudio]' || content === '[audio]';
  return message.mediaType === 'sticker' && (content === '[figurinha]' || content === '[sticker]' || !content);
};

const mergeConversationMessages = (current: Message[], incoming: Message[]) => {
  const byId = new Map<string, Message>();
  current.forEach((message) => byId.set(message.id, message));
  incoming.forEach((message) => byId.set(message.id, message));
  return Array.from(byId.values()).sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));
};

const formatMessageTimestamp = (timestampMs: number | undefined, fallback: string) => {
  if (!timestampMs || !Number.isFinite(timestampMs)) return fallback;
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return fallback;
  const now = new Date();
  const isToday = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  const dayMonth = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${dayMonth} - ${time}`;
};

const normalizeSearchText = (value: string) => value
  .toLocaleLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const isPhoneOnlyName = (value?: string | null) => !value || /^\+?[\d\s().-]+$/.test(value.trim());

const extractBusinessProfile = (profile: any) => {
  const value = profile?.data || profile?.businessProfile || profile || {};
  return {
    ...value,
    name: value.verifiedName || value.businessName || value.name || value.profileName || '',
  };
};

type GoogleContactForm = {
  name: string;
  phone: string;
  otherPhone: string;
  email: string;
  cpf: string;
  address: string;
  resourceName: string;
};

type ConversationFilter = 'all' | 'unread' | 'unanswered' | 'delivery' | 'resolved';

const AudioMessagePlayer: React.FC<{ src: string; durationHint?: number }> = ({ src, durationHint }) => {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationHint || 0);
  const [playbackRate, setPlaybackRate] = useState(1);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  };

  const seek = (value: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = value;
    setCurrentTime(value);
  };

  const cyclePlaybackRate = () => {
    const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  };

  return (
    <div className="w-[310px] max-w-[58vw] flex items-center gap-3 px-3 py-2.5 rounded-xl bg-black/20 border border-white/10 shadow-inner">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration);
        }}
      />
      <button type="button" onClick={togglePlayback} className="w-9 h-9 rounded-full bg-amber-400 text-zinc-950 flex items-center justify-center flex-shrink-0 hover:bg-amber-300 transition-colors">
        {playing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0 space-y-1">
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(currentTime, duration || 1)}
          onChange={(event) => seek(Number(event.target.value))}
          className="w-full h-1 accent-amber-400 cursor-pointer"
          aria-label="Posição do áudio"
        />
        <div className="flex justify-between text-[10px] text-slate-400 font-medium tabular-nums">
          <span>{formatAudioTime(currentTime)}</span>
          <span>{formatAudioTime(duration || durationHint || 0)}</span>
        </div>
      </div>
      <button type="button" onClick={cyclePlaybackRate} className="min-w-9 px-1.5 py-1 rounded-md bg-white/5 text-[11px] font-extrabold text-slate-300 hover:text-amber-300 hover:bg-white/10" title="Velocidade de reprodução">
        {playbackRate.toString().replace('.', ',')}x
      </button>
      <a href={src} download="audio-whatsapp.ogg" className="p-1.5 rounded-full text-slate-400 hover:text-amber-300 hover:bg-white/5" title="Baixar áudio">
        <Download className="w-4 h-4" />
      </a>
    </div>
  );
};

const MediaMessageContent: React.FC<{ msg: Message; instanceName: string }> = ({ msg, instanceName }) => {
  const isMedia = msg.mediaType === 'image' || msg.mediaType === 'audio' || msg.mediaType === 'video' || msg.mediaType === 'document' || msg.mediaType === 'sticker';
  if (!isMedia) return null;

  const isDataUri = (url?: string | null) => !!url && url.startsWith('data:');

  const [src, setSrc] = useState<string | null>(isDataUri(msg.mediaUrl) ? msg.mediaUrl! : null);
  const [loadingMedia, setLoadingMedia] = useState<boolean>(!isDataUri(msg.mediaUrl) && !!msg.rawKey);
  const [showModal, setShowModal] = useState<boolean>(false);

  useEffect(() => {
    if (msg.rawKey) {
      let isMounted = true;
      if (!src) setLoadingMedia(true);
      EvolutionApiService.getDecodedMedia(instanceName, msg.rawKey).then(base64 => {
        if (isMounted) {
          if (base64) {
            setSrc(base64);
          }
          setLoadingMedia(false);
        }
      });
      return () => { isMounted = false; };
    }
  }, [msg.id, instanceName]);

  if (loadingMedia) {
    return (
      <div className="p-2.5 rounded-lg bg-black/30 border border-amber-400/20 text-[11px] text-amber-300 flex items-center gap-2 font-bold animate-pulse my-1 max-w-xs">
        <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
        Descriptografando mídia...
      </div>
    );
  }

  if (msg.mediaType === 'image') {
    const finalImageSrc = src || (isDataUri(msg.mediaUrl) ? msg.mediaUrl : null);

    if (!finalImageSrc) {
      return (
        <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-400 flex items-center gap-2 my-1">
          <ImageIcon className="w-4 h-4 text-zinc-500" />
          <span>Imagem indisponível no WhatsApp</span>
        </div>
      );
    }

    return (
      <>
        <div className="rounded-xl overflow-hidden max-w-xs mb-2 border border-black/20 shadow-xl group relative">
          <img 
            src={finalImageSrc} 
            alt="Imagem WhatsApp" 
            className="w-full h-auto object-cover max-h-72 rounded-lg cursor-pointer hover:opacity-90 transition-all"
            onClick={() => setShowModal(true)}
          />
          <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-md px-2 py-1 rounded text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity font-bold">
            Clique para ampliar 🔍
          </div>
        </div>

        {/* Modal Lightbox de Zoom da Imagem */}
        {showModal && (
          <div 
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setShowModal(false)}
          >
            <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center justify-center" onClick={e => e.stopPropagation()}>
              <div className="absolute -top-12 right-0 flex items-center gap-3">
                <a
                  href={finalImageSrc}
                  download="imagem-whatsapp.jpg"
                  className="px-3 py-1.5 rounded-lg bg-amber-400 text-zinc-950 font-bold text-xs hover:bg-amber-300 transition-colors flex items-center gap-1"
                >
                  Download HD
                </a>
                <button
                  onClick={() => setShowModal(false)}
                  className="w-8 h-8 rounded-full bg-zinc-800 text-zinc-200 hover:text-white font-bold flex items-center justify-center border border-zinc-700"
                >
                  ✕
                </button>
              </div>
              <img 
                src={finalImageSrc} 
                alt="Imagem Ampliada" 
                className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl border border-zinc-800"
              />
            </div>
          </div>
        )}
      </>
    );
  }

  if (msg.mediaType === 'audio' && src) {
    return <AudioMessagePlayer src={src} durationHint={msg.mediaDuration} />;
  }

  if (msg.mediaType === 'video' && src) {
    return (
      <div className="max-w-sm overflow-hidden rounded-xl border border-white/10 bg-black/30 shadow-xl">
        <video
          src={src}
          controls
          preload="metadata"
          className="max-h-80 w-full bg-black object-contain"
          aria-label="Vídeo recebido no WhatsApp"
        />
        <a href={src} download="video-whatsapp.mp4" className="block px-3 py-2 text-center text-[11px] font-bold text-amber-300 hover:bg-white/5">
          Baixar vídeo
        </a>
      </div>
    );
  }

  if (msg.mediaType === 'sticker') {
    if (!src) return <div className="text-[11px] text-slate-400">Figurinha indisponível</div>;
    return (
      <img
        src={src}
        alt="Figurinha do WhatsApp"
        className="w-40 h-40 object-contain drop-shadow-lg"
      />
    );
  }

  if (msg.mediaType === 'audio') {
    return (
      <div className="w-[310px] max-w-[58vw] px-3 py-3 rounded-xl bg-black/20 border border-white/10 text-[11px] text-slate-400">
        Áudio indisponível para reprodução
      </div>
    );
  }

  if (msg.mediaType === 'video') {
    return (
      <div className="w-[310px] max-w-[58vw] rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-[11px] text-slate-400">
        Vídeo indisponível para reprodução
      </div>
    );
  }

  if (msg.mediaType === 'document' && src) {
    return (
      <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-black/30 my-1 border border-white/10 max-w-xs shadow-inner">
        <Paperclip className="w-4 h-4 flex-shrink-0 text-amber-400" />
        <span className="truncate flex-1 font-bold text-xs">{msg.content || 'Documento'}</span>
        <a 
          href={src} 
          download="documento.pdf"
          className="px-2.5 py-1 rounded bg-amber-400 text-zinc-950 font-bold hover:bg-amber-300 transition-colors text-[11px]"
        >
          Baixar
        </a>
      </div>
    );
  }

  return null;
};

export const AtendimentoPage: React.FC = () => {
  const instanceName = 'vitstock_atendimento';
  const isMock = import.meta.env.VITE_USE_MOCK_DATA === 'true';
  const location = useLocation();
  const { user } = useAuth();
  const attendantLabel = user
    ? `${user.name} • ${user.companyName || 'Vitstock'}`
    : 'Atendente • Vitstock';

  const attendantName = user?.name || 'Atendente';
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>('');
  const [filterTab, setFilterTab] = useState<ConversationFilter>('all');
  const [conversationSearch, setConversationSearch] = useState('');
  const [inputText, setInputText] = useState('');
  const [sendingMedia, setSendingMedia] = useState(false);
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [businessProfile, setBusinessProfile] = useState<any | null>(null);
  const [loadingBusinessProfile, setLoadingBusinessProfile] = useState(false);
  const [savingGoogleContact, setSavingGoogleContact] = useState(false);
  const [googleContactFeedback, setGoogleContactFeedback] = useState('');
  const [googleContactStatus, setGoogleContactStatus] = useState<'checking' | 'saved' | 'not_saved' | 'unavailable'>('checking');
  const [googleMatchedName, setGoogleMatchedName] = useState<string | null>(null);
  const [capturingChat, setCapturingChat] = useState(false);
  const [assignmentFeedback, setAssignmentFeedback] = useState('');
  const [showGoogleContactForm, setShowGoogleContactForm] = useState(false);
  const [googleContactForm, setGoogleContactForm] = useState<GoogleContactForm>({
    name: '', phone: '', otherPhone: '', email: '', cpf: '', address: '', resourceName: '',
  });

  // Estado para Nova Conversa por Telefone
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatNumber, setNewChatNumber] = useState('');
  const [newChatName, setNewChatName] = useState('');
  const [newChatMessage, setNewChatMessage] = useState('');
  const [startingNewChat, setStartingNewChat] = useState(false);

  // Mensagens do chat ativo
  const [messages, setMessages] = useState<Message[]>([]);
  const readOverridesRef = React.useRef(new Map<string, number>());
  const conversationsRef = React.useRef<Conversation[]>([]);
  const activeConvIdRef = React.useRef('');

  useEffect(() => {
    const state = location.state as { startChat?: { phone?: string; name?: string } } | null;
    if (!state?.startChat?.phone) return;
    setNewChatNumber(state.startChat.phone.replace(/\D/g, ''));
    setNewChatName(state.startChat.name || '');
    setNewChatMessage('');
    setAssignmentFeedback('');
    setShowNewChatModal(true);
  }, [location.state]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    activeConvIdRef.current = activeConvId;
  }, [activeConvId]);


  // Carregar conversas ao iniciar e manter atualizado a cada 4 segundos
  useEffect(() => {
    loadChats();

    if (isMock) return;

    const interval = setInterval(() => {
      loadChats(false); // Atualização silenciosa em segundo plano
    }, 4000);

    return () => clearInterval(interval);
  }, [isMock]);

  const messagesContainerRef = React.useRef<HTMLDivElement>(null);
  const attachmentInputRef = React.useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  };

  // Carregar mensagens quando trocar de conversa e manter sincronizado a cada 2 segundos
  useEffect(() => {
    if (!activeConvId || isMock) return;

    let isSubscribed = true;
    let isInitialFetch = true;
    let shouldReconcile = true;
    setMessages([]);

    const fetchConvMessages = async () => {
      const container = messagesContainerRef.current;
      const distanceFromBottom = container
        ? container.scrollHeight - container.scrollTop - container.clientHeight
        : 0;
      const shouldScroll = isInitialFetch || distanceFromBottom <= 120;
      isInitialFetch = false;
      const phone = conversationsRef.current.find((conversation) => conversation.id === activeConvId)?.contact.phone || activeConvId;
      const reconcileThisFetch = shouldReconcile;
      shouldReconcile = false;
      const realMsgs = await EvolutionApiService.fetchConversationMessages(instanceName, activeConvId, phone, attendantLabel, reconcileThisFetch);
      if (isSubscribed && realMsgs.length > 0) {
        setMessages((previous) => mergeConversationMessages(previous, realMsgs));
        if (shouldScroll) window.setTimeout(scrollToBottom, 0);
      }
    };

    fetchConvMessages();

    const interval = setInterval(fetchConvMessages, 2000);
    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [activeConvId, attendantLabel, isMock, instanceName]);

  // Rolar para a última mensagem automaticamente quando a conversa mudar ou chegar mensagem nova
  const loadChats = async (showLoading = true) => {
    if (showLoading) setLoadingChats(true);
    if (isMock) {
      setConversations(mockConversations);
      setActiveConvId(mockConversations[0]?.id || '');
    } else {
      const realChats = await EvolutionApiService.fetchRealChats(instanceName);
      if (realChats.length > 0) {
        const previousActiveConversation = conversationsRef.current.find((conversation) => conversation.id === activeConvIdRef.current);
        const previousActivePhone = previousActiveConversation?.contact.phone.replace(/\D/g, '');
        const mergedChats = realChats.map((conversation) => {
          const locallyReadAt = readOverridesRef.current.get(conversation.id);
          return locallyReadAt && conversation.lastMessageAt && conversation.lastMessageAt <= locallyReadAt
            ? { ...conversation, unreadCount: 0 }
            : conversation;
        });
        setConversations(mergedChats);
        setActiveConvId((previousId) => {
          if (mergedChats.some((conversation) => conversation.id === previousId)) return previousId;
          const replacement = previousActivePhone
            ? mergedChats.find((conversation) => conversation.contact.phone.replace(/\D/g, '') === previousActivePhone)
            : undefined;
          return replacement?.id || previousId || mergedChats[0].id;
        });
      } else {
        // Uma resposta vazia pode ocorrer enquanto a Evolution reorganiza o chat após o envio.
        // Mantemos a lista atual para não fechar a conversa ativa por engano.
        setConversations((previous) => previous.length > 0 ? previous : []);
      }
    }
    if (showLoading) setLoadingChats(false);
  };


  const activeConv = conversations.find(c => c.id === activeConvId);
  const activeChatLocked = Boolean(
    activeConv?.assignedAttendant
      && activeConv.assignedAttendant.id !== user?.id
      && user?.role !== 'admin',
  );

  useEffect(() => {
    if (!activeConv || isMock || !isPhoneOnlyName(activeConv.contact.name)) return;
    let mounted = true;
    EvolutionApiService.fetchBusinessProfile(activeConv.contact.phone).then((profile) => {
      if (!mounted || !profile) return;
      const normalizedProfile = extractBusinessProfile(profile);
      if (!normalizedProfile.name) return;
      setBusinessProfile(normalizedProfile);
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id && isPhoneOnlyName(conversation.contact.name) ? {
        ...conversation,
        contact: { ...conversation.contact, name: normalizedProfile.name },
      } : conversation));
    });
    return () => { mounted = false; };
  }, [activeConvId, isMock]);

  const normalizedConversationSearch = normalizeSearchText(conversationSearch.trim());
  const visibleConversations = conversations.filter((conversation) => {
    const matchesFilter = filterTab === 'all'
      || filterTab === 'unread' && conversation.unreadCount > 0
      || filterTab === 'unanswered' && conversationNeedsResponse(conversation)
      || filterTab === 'delivery' && conversation.status === 'pending'
      || filterTab === 'resolved' && conversation.status === 'resolved';
    if (!matchesFilter) return false;
    if (!normalizedConversationSearch) return true;
    return [conversation.contact.name, conversation.contact.phone]
      .some((value) => normalizeSearchText(value).includes(normalizedConversationSearch));
  });

  const markConversationAsRead = async (conversation: Conversation) => {
    setConversations((previous) => previous.map((item) => item.id === conversation.id ? { ...item, unreadCount: 0 } : item));
    if (!conversation.lastMessageAt) return;

    readOverridesRef.current.set(conversation.id, conversation.lastMessageAt);
    try {
      await EvolutionApiService.markChatAsRead(conversation.id, conversation.lastMessageAt, conversation.lastMessageKey);
    } catch (error) {
      console.warn('[Atendimento] NÃ£o foi possÃ­vel persistir a leitura:', error);
    }
  };

  const captureActiveChat = async () => {
    if (!activeConv || isMock) return;
    setCapturingChat(true);
    setAssignmentFeedback('');
    try {
      const result = await EvolutionApiService.captureChat(activeConv.id, activeConv.contact.phone);
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
        ...conversation,
        assignedAttendant: result.user,
        contact: {
          ...conversation.contact,
          tags: [{ id: `assigned-${result.user.id}`, name: result.user.name, color: '#A78BFA' }],
        },
      } : conversation));
      setAssignmentFeedback('Atendimento capturado.');
    } catch (error) {
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível capturar o atendimento');
      await loadChats(false);
    } finally {
      setCapturingChat(false);
    }
  };

  const releaseActiveChat = async () => {
    if (!activeConv || isMock) return;
    setCapturingChat(true);
    setAssignmentFeedback('');
    try {
      await EvolutionApiService.releaseChat(activeConv.id, activeConv.contact.phone);
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
        ...conversation,
        assignedAttendant: undefined,
        contact: {
          ...conversation.contact,
          tags: [],
        },
      } : conversation));
      setAssignmentFeedback('Atendimento liberado para a equipe.');
    } catch (error) {
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível liberar o atendimento');
    } finally {
      setCapturingChat(false);
    }
  };

  const updateActiveChatStatus = async (status: ChatStatus) => {
    if (!activeConv) return;

    const previousStatus = activeConv.status;
    const previousNeedsResponse = conversationNeedsResponse(activeConv);
    setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
      ...conversation,
      status,
      needsResponse: status === 'resolved'
        ? false
        : conversation.lastMessageFromMe
          ? false
          : conversation.needsResponse ?? conversation.unreadCount > 0,
    } : conversation));
    setAssignmentFeedback('');

    if (isMock) {
      setAssignmentFeedback(status === 'resolved' ? 'Conversa resolvida.' : status === 'pending' ? 'Conversa marcada como pendente.' : 'Conversa reaberta.');
      return;
    }

    try {
      await EvolutionApiService.updateChatStatus(activeConv.id, status, activeConv.contact.phone);
      setAssignmentFeedback(status === 'resolved' ? 'Conversa resolvida.' : status === 'pending' ? 'Conversa marcada como pendente.' : 'Conversa reaberta.');
    } catch (error) {
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
        ...conversation,
        status: previousStatus,
        needsResponse: previousNeedsResponse,
      } : conversation));
      setAssignmentFeedback(error instanceof Error ? error.message : 'NÃ£o foi possÃ­vel atualizar o status');
    }
  };

  const saveContactToGoogle = async () => {
    if (!activeConv) return;
    setSavingGoogleContact(true);
    setGoogleContactFeedback('');
    try {
      const result = await apiRequest<{ googleSynced: boolean }>('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({
          name: activeConv.contact.name,
          phone: activeConv.contact.phone,
        }),
      });
    setGoogleContactStatus(result.googleSynced ? 'saved' : 'unavailable');
      setGoogleMatchedName(result.googleSynced ? activeConv.contact.name : null);
      setGoogleContactFeedback(result.googleSynced ? 'Contato atualizado no Google Contacts.' : 'Salvo no Hub. Conecte o Google Contacts para sincronizar.');
    } catch (error) {
      setGoogleContactFeedback(error instanceof Error ? error.message : 'Não foi possível salvar o contato');
    } finally {
      setSavingGoogleContact(false);
    }
  };

  const openGoogleContactForm = () => {
    if (!activeConv) return;
    setGoogleContactFeedback('');
    setGoogleContactForm((current) => ({
      ...current,
      name: current.name || (googleMatchedName && !/^\+?[0-9 ]+$/.test(googleMatchedName) ? googleMatchedName : ''),
      phone: activeConv.contact.phone,
    }));
    setShowGoogleContactForm(true);
  };

  const saveGoogleContactForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeConv || !googleContactForm.name.trim() || !googleContactForm.phone.trim()) return;
    setSavingGoogleContact(true);
    setGoogleContactFeedback('');
    try {
      const result = await apiRequest<{ saved: boolean; name: string; resourceName: string | null; phone: string; otherPhone: string }>('/api/google/contact', {
        method: 'POST',
        body: JSON.stringify(googleContactForm),
      });
      setGoogleContactStatus('saved');
      setGoogleMatchedName(result.name);
      setShowGoogleContactForm(false);
      setGoogleContactFeedback('Contato salvo no Google Contacts.');
      setGoogleContactForm((current) => ({ ...current, resourceName: result.resourceName || current.resourceName }));
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
        ...conversation,
        contact: { ...conversation.contact, name: googleContactForm.name, phone: googleContactForm.phone },
      } : conversation));
    } catch (error) {
      setGoogleContactFeedback(error instanceof Error ? error.message : 'Não foi possível salvar o contato');
    } finally {
      setSavingGoogleContact(false);
    }
  };

  useEffect(() => {
    if (!showContactInfo || !activeConv) return;
    let mounted = true;
    setLoadingBusinessProfile(true);
    setBusinessProfile(null);
    setGoogleContactStatus('checking');
    setGoogleMatchedName(null);
    setGoogleContactFeedback('');
    apiRequest<{ connected: boolean; saved: boolean; name: string | null; resourceName: string | null; email: string; cpf: string; address: string; otherPhone: string }>('/api/google/contact-status', {
      method: 'POST',
      body: JSON.stringify({ phone: activeConv.contact.phone }),
    }).then((status) => {
      if (mounted) {
        setGoogleContactStatus(!status.connected ? 'unavailable' : status.saved ? 'saved' : 'not_saved');
        setGoogleMatchedName(status.saved ? status.name : null);
        setGoogleContactForm({
          name: status.saved && status.name ? status.name : (/^\+?[0-9 ]+$/.test(activeConv.contact.name) ? '' : activeConv.contact.name),
          phone: activeConv.contact.phone,
          otherPhone: status.otherPhone || '',
          email: status.email || '',
          cpf: status.cpf || '',
          address: status.address || '',
          resourceName: status.resourceName || '',
        });
      }
    }).catch(() => {
      if (mounted) {
        setGoogleContactStatus('unavailable');
        setGoogleContactForm({
          name: /^\+?[0-9 ]+$/.test(activeConv.contact.name) ? '' : activeConv.contact.name,
          phone: activeConv.contact.phone,
          otherPhone: '', email: '', cpf: '', address: '', resourceName: '',
        });
      }
    });
    EvolutionApiService.fetchBusinessProfile(activeConv.contact.phone)
      .then((profile) => {
        if (!mounted || !profile) return;
        const normalizedProfile = extractBusinessProfile(profile);
        setBusinessProfile(normalizedProfile);
        if (normalizedProfile.name && isPhoneOnlyName(activeConv.contact.name)) {
          setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
            ...conversation,
            contact: { ...conversation.contact, name: normalizedProfile.name },
          } : conversation));
        }
      })
      .finally(() => { if (mounted) setLoadingBusinessProfile(false); });
    return () => { mounted = false; setShowGoogleContactForm(false); };
  }, [showContactInfo, activeConvId]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConv || activeChatLocked) return;

    const newMsgText = inputText.trim();
    const outboundText = `*${attendantName}*\n${newMsgText}`;
    setInputText('');

    const newMsg: Message = {
      id: `msg-${Date.now()}`,
      conversationId: activeConv.id,
      sender: 'attendant',
      senderName: attendantName,
      content: newMsgText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestampMs: Date.now(),
      status: isInternalNote ? 'sent' : 'pending',
      isInternalNote
    };

    setMessages(prev => [...prev, newMsg]);
    window.setTimeout(scrollToBottom, 0);

    // Se NÃO for nota interna e NÃO for mock, envia mensagem real no WhatsApp via Evolution API!
    if (isInternalNote && !isMock) {
      try {
        const savedNote = await EvolutionApiService.saveInternalNote(activeConv.id, activeConv.contact.phone, newMsgText);
        setMessages((previous) => previous.map((message) => message.id === newMsg.id ? savedNote : message));
      } catch (error) {
        setMessages((previous) => previous.filter((message) => message.id !== newMsg.id));
        setInputText(newMsgText);
        setAssignmentFeedback(error instanceof Error ? error.message : 'NÃ£o foi possÃ­vel salvar a nota interna.');
        return;
      }
    }

    if (!isInternalNote && !isMock) {
      try {
      const result = await EvolutionApiService.sendTextMessage(instanceName, activeConv.contact.phone, outboundText, activeConv.id);
      setMessages((previous) => previous.map((message) => message.id === newMsg.id ? {
        ...message,
        id: result?.message?.evolutionMessageId || result?.message?.id || message.id,
        status: 'sent',
      } : message));
      const dailyResponder = result?.dailyResponder;
      if (dailyResponder?.id && dailyResponder?.name) {
        setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
          ...conversation,
          contact: {
            ...conversation.contact,
            tags: [{ id: `daily-responder-${dailyResponder.id}`, name: `👤 ${dailyResponder.name}`, color: '#A78BFA' }],
          },
        } : conversation));
      }
      
      // Busca atualizada do backend imediatamente apos enviar
      setTimeout(async () => {
        const updatedMsgs = await EvolutionApiService.fetchConversationMessages(instanceName, activeConv.id, activeConv.contact.phone, attendantLabel, true);
        if (updatedMsgs.length > 0) setMessages((previous) => mergeConversationMessages(previous, updatedMsgs));
        loadChats(false);
      }, 800);
      } catch (error) {
        setMessages((previous) => previous.map((message) => message.id === newMsg.id ? { ...message, status: 'failed' } : message));
        setInputText(newMsgText);
        setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível enviar a mensagem.');
        return;
      }
    }

    // Atualiza última mensagem na lista lateral
    setConversations(prev => prev.map(c => c.id === activeConv.id ? {
      ...c,
      lastMessage: isInternalNote ? `[Nota Interna]: ${newMsgText}` : newMsgText,
      lastMessageTimestamp: 'Agora',
      unreadCount: 0,
      lastMessageFromMe: !isInternalNote,
      needsResponse: false,
    } : c));
  };

  const handleAttachmentChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !activeConv || activeChatLocked || isInternalNote || sendingMedia) return;
    if (file.size > 10 * 1024 * 1024) {
      setAssignmentFeedback('O anexo deve ter no máximo 10 MB.');
      return;
    }
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const fileExtension = file.name.toLowerCase().split('.').pop() || '';
    const isDocument = file.type === 'application/pdf'
      || file.type.startsWith('application/msword')
      || file.type.startsWith('application/vnd.openxmlformats-officedocument')
      || ['pdf', 'doc', 'docx'].includes(fileExtension);
    if (!isImage && !isVideo && !isDocument) {
      setAssignmentFeedback('Formato não suportado. Envie uma imagem, vídeo ou documento.');
      return;
    }

    const mediatype: 'image' | 'video' | 'document' = isImage ? 'image' : isVideo ? 'video' : 'document';
    const label = mediatype === 'image' ? '[Imagem]' : mediatype === 'video' ? '[Vídeo]' : '[Documento]';
    const caption = inputText.trim();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Não foi possível ler o anexo'));
      reader.readAsDataURL(file);
    }).catch((error) => {
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível ler o anexo.');
      return '';
    });
    if (!dataUrl) return;
    const media = dataUrl.split(',')[1];
    if (!media) return;
    const localMessage: Message = {
      id: `media-${Date.now()}`,
      conversationId: activeConv.id,
      sender: 'attendant',
      senderName: attendantName,
      content: caption || label,
      mediaUrl: dataUrl,
      mediaType: mediatype,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestampMs: Date.now(),
      status: 'pending',
    };
    setAssignmentFeedback('');
    setSendingMedia(true);
    setInputText('');
    setMessages((previous) => [...previous, localMessage]);
    window.setTimeout(scrollToBottom, 0);
    try {
      const result = await EvolutionApiService.sendMediaMessage({
        instanceName,
        number: activeConv.contact.phone,
        remoteJid: activeConv.id,
        mediatype,
        mimetype: file.type || (mediatype === 'image' ? 'image/jpeg' : mediatype === 'video' ? 'video/mp4' : fileExtension === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
        media,
        fileName: file.name,
        caption: caption || undefined,
      });
      setMessages((previous) => previous.map((message) => message.id === localMessage.id ? {
        ...message,
        id: result?.message?.evolutionMessageId || result?.message?.id || message.id,
        status: 'sent',
      } : message));
      const dailyResponder = result?.dailyResponder;
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
        ...conversation,
        contact: dailyResponder?.id && dailyResponder?.name
          ? {
              ...conversation.contact,
              tags: [{ id: `daily-responder-${dailyResponder.id}`, name: `👤 ${dailyResponder.name}`, color: '#A78BFA' }],
            }
          : conversation.contact,
        lastMessage: caption || label,
        lastMessageTimestamp: 'Agora',
        lastMessageFromMe: true,
        needsResponse: false,
      } : conversation));
      window.setTimeout(() => { void loadChats(false); }, 800);
    } catch (error) {
      setMessages((previous) => previous.map((message) => message.id === localMessage.id ? { ...message, status: 'failed' } : message));
      setInputText(caption);
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível enviar o anexo.');
    } finally {
      setSendingMedia(false);
    }
  };

  const retryFailedMessage = async (message: Message) => {
    if (!activeConv || isMock || message.status !== 'failed' || message.isInternalNote) return;

    const retryText = message.content.trim();
    if (!retryText) return;
    const outboundText = `*${attendantName}*\n${retryText}`;
    setAssignmentFeedback('');
    setMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, status: 'pending' } : item));

    try {
      const result = await EvolutionApiService.sendTextMessage(instanceName, activeConv.contact.phone, outboundText, activeConv.id);
      setMessages((previous) => previous.map((item) => item.id === message.id ? {
        ...item,
        id: result?.message?.evolutionMessageId || result?.message?.id || item.id,
        status: 'sent',
      } : item));
      const dailyResponder = result?.dailyResponder;
      if (dailyResponder?.id && dailyResponder?.name) {
        setConversations((previous) => previous.map((conversation) => conversation.id === activeConv.id ? {
          ...conversation,
          contact: {
            ...conversation.contact,
            tags: [{ id: `daily-responder-${dailyResponder.id}`, name: `👤 ${dailyResponder.name}`, color: '#A78BFA' }],
          },
        } : conversation));
      }
      window.setTimeout(() => { void loadChats(false); }, 800);
    } catch (error) {
      setMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, status: 'failed' } : item));
      setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível reenviar a mensagem.');
    }
  };

  const handleStartNewChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatNumber.trim() || !newChatMessage.trim() || startingNewChat) return;

    const cleanNum = newChatNumber.replace(/\D/g, '');
    if (cleanNum.length < 8) {
      setAssignmentFeedback('Informe um número válido com DDD.');
      return;
    }
    const jid = `${cleanNum}@s.whatsapp.net`;
    const contactName = newChatName.trim() || `+${cleanNum}`;
    const messageText = newChatMessage.trim();
    const outboundText = `*${attendantName}*\n${messageText}`;

    setStartingNewChat(true);
    setAssignmentFeedback('');
    let result: any = null;
    if (!isMock) {
      try {
        result = await EvolutionApiService.sendTextMessage(instanceName, cleanNum, outboundText, jid);
      } catch (error) {
        setAssignmentFeedback(error instanceof Error ? error.message : 'Não foi possível iniciar a conversa.');
        setStartingNewChat(false);
        return;
      }
    }

    const newConv: Conversation = {
      id: jid,
      contact: {
        id: jid,
        name: contactName,
        phone: `+${cleanNum}`,
        avatar: '',
        tags: [],
        createdAt: new Date().toISOString().split('T')[0]
      },
      lastMessage: messageText,
      lastMessageTimestamp: 'Agora',
      unreadCount: 0,
      lastMessageFromMe: true,
      needsResponse: false,
      status: 'open',
      department: 'Atendimento Geral'
    };

    setConversations(prev => [newConv, ...prev]);
    setActiveConvId(jid);
    setMessages([{
      id: result?.message?.id || `new-chat-${Date.now()}`,
      conversationId: jid,
      sender: 'attendant',
      senderName: attendantName,
      content: messageText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestampMs: Date.now(),
      status: 'sent',
    }]);
    setShowNewChatModal(false);
    setNewChatNumber('');
    setNewChatName('');
    setNewChatMessage('');
    setStartingNewChat(false);
    window.setTimeout(() => { void loadChats(false); }, 800);
  };

  const insertQuickReply = (text: string) => {
    setInputText(text);
    setQuickReplyOpen(false);
  };

  return (
    <div className="flex h-full w-full bg-[#11181d] overflow-hidden text-slate-100 font-overpass relative">
      
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
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">Primeira mensagem</label>
                <textarea
                  value={newChatMessage}
                  onChange={e => setNewChatMessage(e.target.value)}
                  placeholder="Escreva a mensagem que será enviada agora..."
                  rows={3}
                  className="w-full resize-none bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-400"
                  required
                />
              </div>
              {assignmentFeedback && <p className="text-xs font-semibold text-red-300">{assignmentFeedback}</p>}
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
                  disabled={startingNewChat}
                  className="px-4 py-2 rounded-xl bg-amber-400 text-zinc-950 text-xs font-extrabold hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
                >
                  {startingNewChat ? 'Enviando...' : 'Enviar e iniciar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Coluna 1: Lista de Conversas (Inbox) */}
      <div className="w-[340px] border-r border-[#344047] flex flex-col bg-[#182126] flex-shrink-0">
        
        {/* Topo do Inbox: Busca e Filtros */}
        <div className="p-4 border-b border-[#344047] bg-[#20292f] space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-extrabold tracking-tight text-zinc-100 flex items-center gap-2">
              Atendimento
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
                className="p-1.5 rounded-lg bg-[#2a343a] border border-[#46535a] text-slate-300 hover:text-amber-300 transition-colors"
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
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
              aria-label="Buscar atendimento por nome ou telefone"
              className="w-full bg-[#2a343a] border border-transparent rounded-full pl-9 pr-3 py-2.5 text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-amber-400/70 transition-colors"
            />
          </div>

          {/* Filtros de atendimento */}
          <div className="grid grid-cols-6 gap-1.5 rounded-xl border border-[#3a474e] bg-[#141d22] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025),0_8px_24px_rgba(0,0,0,0.14)]">
            {(['all', 'unread', 'unanswered', 'delivery', 'resolved'] as const).map(tab => {
              const count = tab === 'all'
                ? conversations.length
                : tab === 'unread'
                  ? conversations.filter((conversation) => conversation.unreadCount > 0).length
                  : tab === 'unanswered'
                    ? conversations.filter(conversationNeedsResponse).length
                    : tab === 'delivery'
                      ? conversations.filter((conversation) => conversation.status === 'pending').length
                      : conversations.filter((conversation) => conversation.status === 'resolved').length;
              const tabLabel = tab === 'all'
                ? 'Todos'
                : tab === 'unread'
                  ? 'Não lidas'
                  : tab === 'unanswered'
                    ? 'Não respondidas'
                    : tab === 'delivery'
                      ? 'Entregas'
                      : 'Resolvidas';
              const tabWidth = tab === 'all' || tab === 'unread' || tab === 'unanswered'
                ? 'col-span-3'
                : tab === 'delivery'
                  ? 'col-span-2'
                : tab === 'resolved'
                    ? 'col-span-1'
                    : 'col-span-2';
              const isActive = filterTab === tab;

              return (
                <button
                  key={tab}
                  onClick={() => setFilterTab(tab)}
                  title={tab === 'resolved' ? `${tabLabel}: ${count}` : undefined}
                  aria-label={`${tabLabel}: ${count}`}
                  aria-pressed={isActive}
                  className={`${tabWidth} group relative flex h-9 min-w-0 items-center overflow-hidden rounded-lg border ${tab === 'resolved' ? 'justify-center pl-2 pr-6' : 'justify-start pl-2.5 pr-8'} text-[11px] font-semibold tracking-[-0.01em] transition-all duration-200 ${
                    isActive
                      ? 'border-amber-300/80 bg-gradient-to-b from-amber-300 to-amber-400 text-[#17130a] shadow-[0_4px_14px_rgba(251,191,36,0.18),inset_0_1px_0_rgba(255,255,255,0.55)]'
                      : 'border-transparent bg-[#1b252a] text-slate-300 hover:border-[#46545c] hover:bg-[#222e34] hover:text-white'
                  }`}
                >
                  {tab === 'resolved' ? (
                    <Archive className="h-[17px] w-[17px] shrink-0" strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <span className="truncate whitespace-nowrap">{tabLabel}</span>
                  )}
                  <span className={`inline-flex shrink-0 items-center justify-center rounded-md border font-extrabold leading-none tabular-nums ${
                    tab === 'resolved'
                      ? 'absolute right-1 top-1 h-4 min-w-4 px-1 text-[9px]'
                      : 'absolute right-1.5 top-1/2 h-5 min-w-6 -translate-y-1/2 px-1.5 text-[10px]'
                  } ${
                    isActive
                      ? 'border-[#17130a]/15 bg-[#17130a] text-amber-300'
                      : 'border-[#3b484f] bg-[#263239] text-slate-200 group-hover:border-[#52616a]'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Lista de Conversas com Scroll */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#273239]">
          {conversations.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <MessageSquare className="w-8 h-8 text-zinc-600 mx-auto" />
              <p className="text-xs font-bold text-zinc-400">Nenhuma conversa encontrada</p>
              <p className="text-[11px] text-zinc-500">Assim que um cliente enviar mensagem no seu WhatsApp, ela aparecerá aqui em tempo real.</p>
            </div>
           ) : visibleConversations.length === 0 ? (
             <div className="p-8 text-center space-y-2">
               <Search className="w-8 h-8 text-zinc-600 mx-auto" />
               <p className="text-xs font-bold text-zinc-400">Nenhum atendimento corresponde à busca</p>
               <p className="text-[11px] text-zinc-500">Tente outro nome ou número de telefone.</p>
             </div>
           ) : (
             visibleConversations.map(conv => {
                const isSelected = conv.id === activeConvId;
                const needsResponse = conversationNeedsResponse(conv);
                return (
                  <div
                    key={conv.id}
                    onClick={() => {
                      setActiveConvId(conv.id);
                      void markConversationAsRead(conv);
                    }}
                    className={`p-3.5 cursor-pointer transition-colors relative flex items-start gap-3 ${
                      isSelected ? 'bg-[#2b353b] border-l-4 border-amber-400' : needsResponse ? 'bg-[#24383d] border-l-4 border-emerald-400 hover:bg-[#2a4247]' : 'border-l-4 border-transparent hover:bg-[#222d33]'
                    }`}
                  >
                    <div className="relative flex-shrink-0">
                      <ContactPhoto name={conv.contact.name} avatar={conv.contact.avatar} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <p className={`text-xs truncate ${needsResponse ? 'font-extrabold text-white' : 'font-bold text-zinc-100'}`}>{conv.contact.name}</p>
                        <span className="text-[10px] font-semibold text-zinc-500">{formatMessageTimestamp(conv.lastMessageAt, conv.lastMessageTimestamp)}</span>
                      </div>

                      <p className={`text-xs truncate mb-1.5 ${needsResponse ? 'font-bold text-slate-200' : 'text-zinc-400'}`}>{conv.lastMessage}</p>

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
      <div className="flex-1 flex flex-col bg-[#152027] overflow-hidden">
        {activeConv ? (
          <>
            {/* Cabeçalho do Chat */}
            <div className="h-16 px-5 border-b border-[#344047] bg-[#20292f] flex items-center justify-between flex-shrink-0">
              <button type="button" onClick={() => setShowContactInfo(true)} className="flex items-center gap-3 rounded-lg hover:bg-white/5 pr-3 py-1 transition-colors text-left">
                <ContactPhoto name={activeConv.contact.name} avatar={activeConv.contact.avatar} emphasized />
                <div>
                  <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    {activeConv.contact.name}
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold">
                      WhatsApp Conectado
                    </span>
                  </h2>
                  <p className="text-xs text-zinc-400 font-mono">{activeConv.contact.phone}</p>
                </div>
              </button>

              {/* Ações Rápidas do Atendimento */}
              <div className="flex items-center gap-2">
                {false && (activeConv!.assignedAttendant ? (
                  activeConv!.assignedAttendant!.id === user?.id ? (
                    <button type="button" onClick={releaseActiveChat} disabled={capturingChat} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-400/10 text-violet-300 border border-violet-400/30 hover:bg-violet-400 hover:text-zinc-950 transition-all flex items-center gap-1.5 disabled:opacity-60">
                      <UserCheck className="w-3.5 h-3.5" /> {capturingChat ? 'Atualizando...' : 'Liberar atendimento'}
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-400/10 text-violet-300 border border-violet-400/30 flex items-center gap-1.5" title="Este atendimento foi capturado por outro usuário">
                      <UserCheck className="w-3.5 h-3.5" /> {activeConv!.assignedAttendant!.name}
                    </span>
                  )
                ) : (
                  <button type="button" onClick={captureActiveChat} disabled={capturingChat} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-400/10 text-amber-300 border border-amber-400/30 hover:bg-amber-400 hover:text-zinc-950 transition-all flex items-center gap-1.5 disabled:opacity-60">
                    <UserCheck className="w-3.5 h-3.5" /> {capturingChat ? 'Capturando...' : 'Capturar atendimento'}
                  </button>
                ))}
                <button type="button" onClick={() => updateActiveChatStatus(activeConv.status === 'resolved' ? 'open' : 'resolved')} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500 hover:text-zinc-950 transition-all flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5" />
                  {activeConv.status === 'resolved' ? 'Reabrir Conversa' : 'Concluído'}
                </button>
                {activeConv.status !== 'resolved' && (
                  <button
                    type="button"
                    onClick={() => updateActiveChatStatus(activeConv.status === 'pending' ? 'open' : 'pending')}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-400/10 text-slate-300 border border-slate-400/20 hover:bg-slate-400 hover:text-zinc-950 transition-all"
                  >
                    {activeConv.status === 'pending' ? 'Retirar da Entrega' : 'Solicitar Entrega'}
                  </button>
                )}
                <button className="p-2 rounded-lg text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>

            {assignmentFeedback && <div className="px-5 py-2 text-xs font-semibold text-violet-200 bg-violet-400/10 border-b border-violet-400/20">{assignmentFeedback}</div>}

            {/* Mensagens com Scroll */}
            <div ref={messagesContainerRef} style={{ overflowAnchor: 'none' }} className="chat-wallpaper flex-1 px-6 py-5 overflow-y-auto space-y-3">
              <div className="flex justify-center my-2">
                <span className="text-[10px] font-bold px-3 py-1 rounded-lg bg-[#20292f]/95 border border-white/5 text-slate-400 shadow-sm">
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
                          <span className="text-[10px] opacity-70 ml-auto">{formatMessageTimestamp(msg.timestampMs, msg.timestamp)}</span>
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
                    className={`flex gap-2 max-w-[72%] animate-fade-in ${isMe ? 'ml-auto flex-row-reverse' : ''}`}
                  >
                    {!isMe && (
                      <ContactPhoto name={activeConv.contact.name} avatar={activeConv.contact.avatar} size="small" />
                    )}
                    <div>
                      <div className={`px-3 py-2.5 rounded-lg text-[13px] leading-relaxed space-y-2 shadow-sm ${
                        isMe 
                          ? 'bg-[#5b4b20] text-[#fff8df] border border-amber-300/15 font-medium rounded-tr-none'
                          : 'bg-[#273238] text-slate-100 border border-white/5 rounded-tl-none'
                      }`}>
                        {isMe && (
                          <p className="text-[10px] font-bold text-amber-200/75 mb-1">{msg.senderName}</p>
                        )}

                        {/* Renderização Inteligente de Mídias (Imagem, Áudio, Documentos em Base64) */}
                        <MediaMessageContent msg={msg} instanceName={instanceName} />
                        <SpecialMessageContent msg={msg} />
                        <InteractiveMessageContent msg={msg} />

                        {/* Texto da Mensagem */}
                        {!msg.metadata?.contactCard && !msg.metadata?.location && !msg.metadata?.systemLabel && <>
                        {!isMediaPlaceholder(msg) && msg.content && !msg.content.startsWith('🖼️') && !msg.content.startsWith('🎵') && !msg.content.startsWith('🎬') && (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        )}
                        </>}
                      </div>
                      <div className={`flex items-center gap-1 mt-1 text-[10px] text-zinc-500 ${isMe ? 'justify-end' : ''}`}>
                        <span>{formatMessageTimestamp(msg.timestampMs, msg.timestamp)}</span>
                        {isMe && msg.status === 'failed' && <span className="font-bold text-red-300">Falha no envio</span>}
                        {isMe && msg.status === 'pending' && <span className="font-semibold text-amber-300">Enviando...</span>}
                        {isMe && msg.status !== 'failed' && msg.status !== 'pending' && (
                          <CheckCheck className={`w-3.5 h-3.5 ${msg.status === 'read' ? 'text-emerald-400' : msg.status === 'delivered' ? 'text-amber-400' : 'text-slate-400'}`} />
                        )}
                        {isMe && msg.status === 'failed' && (
                          <button
                            type="button"
                            onClick={() => { void retryFailedMessage(msg); }}
                            className="ml-1 font-bold text-amber-300 underline decoration-amber-300/50 underline-offset-2 hover:text-amber-200"
                          >
                            Tentar novamente
                          </button>
                        )}
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
            <form onSubmit={handleSendMessage} className="p-3 bg-[#20292f] border-t border-[#344047]">
              {activeChatLocked && (
                <div className="mb-2 rounded-lg border border-violet-300/20 bg-violet-300/10 px-3 py-2 text-[11px] font-semibold text-violet-200">
                  Este atendimento está capturado por {activeConv?.assignedAttendant?.name || 'outro atendente'}.
                </div>
              )}
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
                <input
                  ref={attachmentInputRef}
                  type="file"
                  accept="image/*,video/*,application/pdf,.doc,.docx"
                  className="hidden"
                  onChange={handleAttachmentChange}
                />
                <button
                  type="button"
                  onClick={() => attachmentInputRef.current?.click()}
                  disabled={activeChatLocked || isInternalNote || sendingMedia}
                  title="Enviar imagem, vídeo ou documento"
                  className="p-2.5 rounded-full bg-transparent text-slate-400 hover:text-amber-300 hover:bg-[#2a343a] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                <input 
                  type="text" 
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={activeChatLocked || sendingMedia}
                  placeholder={isInternalNote ? "Digite uma nota interna para a equipe..." : "Digite sua mensagem para o WhatsApp..."}
                  className={`flex-1 bg-[#2a343a] border text-xs text-slate-100 placeholder-slate-400 rounded-full px-4 py-3 focus:outline-none transition-colors ${
                    isInternalNote 
                      ? 'border-amber-400/50 bg-amber-400/5 focus:border-amber-400' 
                      : 'border-transparent focus:border-amber-400/70'
                  }`}
                />

                <button 
                  type="submit"
                  disabled={activeChatLocked || sendingMedia}
                  className={`p-3 rounded-full font-bold flex items-center justify-center transition-all ${
                    isInternalNote 
                      ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400' 
                      : 'bg-amber-400 text-zinc-950 hover:bg-amber-300 shadow-[0_0_12px_rgba(238,187,44,0.3)]'
                  } disabled:cursor-not-allowed disabled:opacity-40`}
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
        <div className="hidden 2xl:flex w-64 border-l border-[#344047] bg-[#182126] p-5 flex-col justify-between flex-shrink-0 overflow-y-auto">
          <div>
            <div className="text-center pb-5 border-b border-zinc-800/80">
              <div className="flex justify-center mb-3">
                <ContactPhoto name={activeConv.contact.name} avatar={activeConv.contact.avatar} size="large" emphasized />
              </div>
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

          <div className="pt-4" style={{ display: 'none' }}>
            <button className="w-full btn-primary text-xs justify-center py-2.5">
              <Kanban className="w-4 h-4" /> Criar Negócio no Funil
            </button>
          </div>
        </div>
      )}

      {showContactInfo && activeConv && (
        <div className="absolute inset-y-0 right-0 z-40 w-[340px] max-w-[90vw] bg-[#182126] border-l border-[#344047] shadow-2xl flex flex-col animate-fade-in">
          <div className="h-16 px-4 border-b border-[#344047] bg-[#20292f] flex items-center justify-between">
            <h3 className="font-extrabold text-sm text-slate-100">Informações do contato</h3>
            <button type="button" onClick={() => setShowContactInfo(false)} className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/5"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="text-center space-y-2">
              <div className="flex justify-center"><ContactPhoto name={activeConv.contact.name} avatar={activeConv.contact.avatar} size="large" emphasized /></div>
              <h4 className="font-extrabold text-slate-100">{businessProfile?.verifiedName || businessProfile?.name || activeConv.contact.name}</h4>
              <p className="text-xs text-amber-300 font-mono">{activeConv.contact.phone}</p>
              {googleContactStatus === 'checking' ? (
                <span className="mx-auto mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#2a343a] text-slate-300 text-xs font-bold"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Verificando Google Contacts...</span>
              ) : googleContactStatus === 'saved' ? (
                <div className="flex flex-col items-center gap-1.5">
                  <span className="mx-auto mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-400/10 border border-emerald-400/30 text-emerald-300 text-xs font-extrabold"><CheckCircle className="w-3.5 h-3.5" /> Já salvo no Google Contacts</span>
                  {googleMatchedName && <span className="text-[11px] text-slate-400">Salvo como: <strong className="text-slate-200">{googleMatchedName}</strong></span>}
                  <button type="button" onClick={openGoogleContactForm} className="mt-1 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-400 text-zinc-950 text-xs font-extrabold hover:bg-amber-300"><Pencil className="w-3.5 h-3.5" /> Editar contato</button>
                </div>
              ) : (
                <button type="button" onClick={openGoogleContactForm} disabled={savingGoogleContact} className="mx-auto mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-400 text-zinc-950 text-xs font-extrabold hover:bg-amber-300 disabled:opacity-60">
                  {savingGoogleContact ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                  {savingGoogleContact ? 'Salvando...' : googleContactStatus === 'unavailable' ? 'Salvar no Google Contacts' : 'Cadastrar no Google Contacts'}
                </button>
              )}
              {googleContactFeedback && <p className="text-[11px] text-emerald-300">{googleContactFeedback}</p>}
              {(businessProfile?.isBusiness || businessProfile?.verifiedName) && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-400/10 border border-emerald-400/30 text-[10px] font-bold text-emerald-300"><Building2 className="w-3.5 h-3.5" /> Conta empresarial</span>
              )}
            </div>
            {loadingBusinessProfile ? (
              <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-6"><RefreshCw className="w-4 h-4 animate-spin" /> Buscando perfil empresarial...</div>
            ) : businessProfile ? (
              <div className="space-y-3 text-xs">
                {businessProfile.description && <div className="p-3 rounded-lg bg-[#20292f] border border-[#344047]"><span className="block text-slate-500 font-bold mb-1">Descrição</span><p className="text-slate-200 whitespace-pre-wrap">{businessProfile.description}</p></div>}
                {businessProfile.category && <div className="p-3 rounded-lg bg-[#20292f] border border-[#344047]"><span className="text-slate-500 font-bold">Categoria: </span><span className="text-slate-200">{Array.isArray(businessProfile.category) ? businessProfile.category.map((item: any) => item.name || item).join(', ') : businessProfile.category}</span></div>}
                {businessProfile.email && <a href={`mailto:${businessProfile.email}`} className="block p-3 rounded-lg bg-[#20292f] border border-[#344047] text-amber-300">{businessProfile.email}</a>}
                {businessProfile.website && <a href={Array.isArray(businessProfile.website) ? businessProfile.website[0] : businessProfile.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 rounded-lg bg-[#20292f] border border-[#344047] text-emerald-300"><Globe className="w-4 h-4" /> Abrir site empresarial</a>}
                {businessProfile.address && <div className="p-3 rounded-lg bg-[#20292f] border border-[#344047] text-slate-200">{businessProfile.address}</div>}
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-[#20292f] border border-[#344047] text-xs text-slate-400 text-center">O WhatsApp não disponibilizou detalhes adicionais deste perfil empresarial.</div>
            )}
          </div>
        </div>
      )}

      {showGoogleContactForm && activeConv && (
        <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <form onSubmit={saveGoogleContactForm} className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl border border-[#46535a] bg-[#182126] shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 border-b border-[#344047] pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-100">{googleContactStatus === 'saved' ? 'Editar contato no Google' : 'Cadastrar contato no Google'}</h3>
                <p className="text-xs text-slate-400 mt-1">Preencha os dados antes de salvar. O nome é obrigatório.</p>
              </div>
              <button type="button" onClick={() => setShowGoogleContactForm(false)} className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/5"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-bold text-slate-300 sm:col-span-2">Nome completo *
                <input required minLength={2} value={googleContactForm.name} onChange={(event) => setGoogleContactForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Carlos Silva" className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300">Telefone WhatsApp *
                <input required readOnly value={googleContactForm.phone} className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#10171b] px-3 py-2.5 text-sm font-mono text-amber-300 outline-none" />
              </label>
              <label className="text-xs font-bold text-slate-300">Outro telefone
                <input value={googleContactForm.otherPhone} onChange={(event) => setGoogleContactForm((current) => ({ ...current, otherPhone: event.target.value }))} placeholder="Ex.: +55 21 98888-7777" className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300">E-mail
                <input type="email" value={googleContactForm.email} onChange={(event) => setGoogleContactForm((current) => ({ ...current, email: event.target.value }))} placeholder="cliente@email.com" className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300">CPF
                <input value={googleContactForm.cpf} onChange={(event) => setGoogleContactForm((current) => ({ ...current, cpf: event.target.value }))} placeholder="000.000.000-00" className="mt-1 w-full rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
              <label className="text-xs font-bold text-slate-300 sm:col-span-2">Endereço
                <textarea rows={3} value={googleContactForm.address} onChange={(event) => setGoogleContactForm((current) => ({ ...current, address: event.target.value }))} placeholder="Rua, número, bairro, cidade e estado" className="mt-1 w-full resize-y rounded-lg border border-[#46535a] bg-[#20292f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </label>
            </div>
            <p className="text-[11px] text-slate-500">O CPF será salvo no campo personalizado do Google Contacts.</p>
            <div className="flex items-center justify-end gap-2 border-t border-[#344047] pt-4">
              <button type="button" onClick={() => setShowGoogleContactForm(false)} className="px-3 py-2 rounded-lg border border-[#46535a] text-xs font-bold text-slate-300 hover:bg-white/5">Cancelar</button>
              <button type="submit" disabled={savingGoogleContact || !googleContactForm.name.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-400 text-zinc-950 text-xs font-extrabold hover:bg-amber-300 disabled:opacity-60"><Save className="w-4 h-4" /> {savingGoogleContact ? 'Salvando...' : 'Salvar contato'}</button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
};
