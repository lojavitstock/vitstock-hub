import React, { useEffect, useState } from 'react';
import {
  CheckCheck,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  File,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Lock,
  MapPin,
  Megaphone,
  Pause,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Play,
  RefreshCw,
  Reply,
  UserRound,
} from 'lucide-react';
import { Conversation, Message } from '../../types';
import { EvolutionApiService } from '../../services/evolutionApi';
import { ContactPhoto } from './ContactPhoto';
import { MediaViewer } from './MediaViewer';
import { formatMessageDay, formatMessageTimestamp } from './conversationFormatters';
import { quotedMediaLabel, quotedMessageExcerpt } from '../../utils/quotedMessage';
import { getDocumentPresentation } from '../../utils/documentMedia';
import { mediaViewerItemFrom, type MediaViewerItem } from '../../utils/mediaViewer';
import { canDownloadMessageMedia, messageCopyText } from '../../utils/messageActions';

type MessageTimelineProps = {
  messages: Message[];
  activeConversation: Conversation;
  instanceName: string;
  containerRef: React.RefObject<HTMLDivElement>;
  hasMoreMessages?: boolean;
  loadingOlderMessages?: boolean;
  loadingMessages?: boolean;
  historyExpanded?: boolean;
  newMessagesCount?: number;
  onLoadOlder?: () => void;
  onJumpToLatest?: () => void;
  onRetryMessage: (message: Message) => void;
  onReplyMessage: (message: Message) => void;
  onLayoutChange?: (reason: string, messageId?: string) => void;
};

const formatAudioTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
};

const isMediaPlaceholder = (message: Message) => {
  const content = message.content.trim().toLocaleLowerCase();
  if (message.mediaType === 'image') return content === '[imagem]' || content === '[image]';
  if (message.mediaType === 'video') return content === '[vídeo]' || content === '[video]';
  if (message.mediaType === 'document') return content === '[documento]' || content === '[document]';
  if (message.mediaType === 'audio') return content === '[mensagem de áudio]' || content === '[audio]';
  return message.mediaType === 'sticker' && (content === '[figurinha]' || content === '[sticker]' || !content);
};

const QuotedMessageBlock: React.FC<{
  message: Message;
  onOpenOriginal: (messageId: string) => void;
  onLayoutChange?: (reason: string, messageId: string) => void;
}> = ({ message, onOpenOriginal, onLayoutChange }) => {
  const quoted = message.metadata?.quotedMessage;
  useEffect(() => {
    if (quoted) onLayoutChange?.('quoted-message.rendered', message.id);
  }, [message.id, onLayoutChange, quoted]);
  if (!quoted) return null;
  const mediaLabel = quotedMediaLabel(quoted.mediaType);
  const excerpt = quotedMessageExcerpt(quoted);
  const hasOnlyMediaPlaceholder = /^\[(imagem|image|vídeo|video|documento|document|mensagem de áudio|audio|figurinha|sticker)\]$/i.test(quoted.content?.trim() || '');

  return (
    <button
      type="button"
      onClick={() => onOpenOriginal(quoted.messageId)}
      className="mb-2 block w-full border-l-2 border-emerald-300/70 bg-black/15 px-2.5 py-2 text-left transition-colors hover:bg-black/25"
      title="Ir para a mensagem citada"
    >
      <span className="block truncate text-xs font-bold text-emerald-200">{quoted.authorName || 'Mensagem citada'}</span>
      <span className="mt-0.5 block truncate text-xs text-slate-200/80">{mediaLabel ? `${mediaLabel}${quoted.content && !hasOnlyMediaPlaceholder ? ` · ${quoted.content}` : ''}` : excerpt}</span>
    </button>
  );
};

const MessageActionMenu: React.FC<{
  message: Message;
  isOpen: boolean;
  align: 'left' | 'right';
  triggerRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
  onReply: () => void;
  onCopy: () => void;
  onDownload?: () => void;
}> = ({ message, isOpen, align, triggerRef, onClose, onReply, onCopy, onDownload }) => {
  const menuRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
    window.addEventListener('pointerdown', closeOnOutside, true);
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutside, true);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;
  const itemClass = 'flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-200 transition-colors hover:bg-white/10 focus:bg-white/10 focus:outline-none';

  return (
    <div ref={menuRef} role="menu" aria-label="Ações da mensagem" className={`absolute top-8 z-30 min-w-36 overflow-hidden rounded-lg border border-white/10 bg-[#243038] py-1 shadow-2xl ${align === 'left' ? 'left-0' : 'right-0'}`}>
      <button type="button" role="menuitem" onClick={onReply} className={itemClass}><Reply className="h-3.5 w-3.5 text-amber-300" /> Responder</button>
      {messageCopyText(message) && <button type="button" role="menuitem" onClick={onCopy} className={itemClass}><Copy className="h-3.5 w-3.5 text-slate-300" /> Copiar</button>}
      {onDownload && canDownloadMessageMedia(message) && <button type="button" role="menuitem" onClick={onDownload} className={itemClass}><Download className="h-3.5 w-3.5 text-amber-300" /> Baixar</button>}
    </div>
  );
};

const InteractiveMessageContent: React.FC<{ message: Message }> = ({ message }) => {
  if (!message.interactiveTitle && !message.interactiveFooter && !message.interactiveButtons?.length) return null;

  return (
    <div className="space-y-2">
      {message.interactiveTitle && <p className="text-sm font-extrabold text-slate-50">{message.interactiveTitle}</p>}
      {message.interactiveFooter && <p className="text-[11px] text-slate-400">{message.interactiveFooter}</p>}
      {message.interactiveButtons?.map((button, index) => {
        const buttonClass = 'mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 font-bold text-emerald-300 hover:bg-emerald-400/20';
        if (button.type === 'url' && button.url) {
          return <a key={`${button.label}-${index}`} href={button.url} target="_blank" rel="noopener noreferrer" className={buttonClass}><ExternalLink className="h-4 w-4" /> {button.label}</a>;
        }
        if (button.type === 'call' && button.value) {
          return <a key={`${button.label}-${index}`} href={`tel:${button.value}`} className={buttonClass}><PhoneCall className="h-4 w-4" /> {button.label}</a>;
        }
        if (button.type === 'copy' && button.value) {
          return <button key={`${button.label}-${index}`} type="button" onClick={() => void navigator.clipboard?.writeText(button.value || '')} className={buttonClass}><Copy className="h-4 w-4" /> {button.label}</button>;
        }
        return <button key={`${button.label}-${index}`} type="button" className="mt-2 w-full rounded-lg border border-slate-500/30 bg-white/5 px-3 py-2 font-bold text-slate-300">{button.label}</button>;
      })}
    </div>
  );
};

const SpecialMessageContent: React.FC<{ message: Message; contactPhone?: string }> = ({ message, contactPhone }) => {
  const metadata = message.metadata;
  if (!metadata) return null;

  const callLabel = metadata.systemLabel || '';
  const isCall = /^Ligação de (?:voz|vídeo) (?:perdida|realizada|recebida)$/i.test(callLabel);
  if (isCall) {
    const missed = / perdida$/i.test(callLabel);
    const outgoing = / realizada$/i.test(callLabel);
    const CallIcon = missed ? PhoneMissed : outgoing ? PhoneOutgoing : PhoneIncoming;
    const iconClass = missed ? 'text-red-400' : outgoing ? 'text-emerald-400' : 'text-sky-400';
    const href = contactPhone ? `tel:${contactPhone.replace(/\D/g, '')}` : undefined;
    return (
      <a href={href} className="flex min-w-[250px] max-w-sm items-center gap-3 rounded-xl border border-white/5 bg-[#202020] px-3.5 py-3 text-left transition-colors hover:bg-[#292929]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/20">
          <CallIcon className={`h-5 w-5 ${iconClass}`} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-100">{callLabel}</span>
          {missed && <span className="mt-0.5 block text-xs text-slate-400">Clique para retornar</span>}
        </span>
      </a>
    );
  }

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
          <span className="whitespace-pre-line text-xs font-bold">{metadata.location.name || 'Localização compartilhada'}{metadata.location.address ? `\n${metadata.location.address}` : ''}</span>
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

const AudioMessagePlayer: React.FC<{ src: string; durationHint?: number }> = ({ src, durationHint }) => {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationHint || 0);
  const [playbackRate, setPlaybackRate] = useState(1);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play();
    else audio.pause();
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
    <div className="flex w-[310px] max-w-[58vw] items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 shadow-inner">
      <audio ref={audioRef} src={src} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration); }} />
      <button type="button" onClick={() => void togglePlayback()} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-400 text-zinc-950 transition-colors hover:bg-amber-300">
        {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
      </button>
      <div className="min-w-0 flex-1 space-y-1">
        <input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(currentTime, duration || 1)} onChange={(event) => seek(Number(event.target.value))} className="h-1 w-full cursor-pointer accent-amber-400" aria-label="Posição do áudio" />
        <div className="flex justify-between text-[10px] font-medium tabular-nums text-slate-400">
          <span>{formatAudioTime(currentTime)}</span>
          <span>{formatAudioTime(duration || durationHint || 0)}</span>
        </div>
      </div>
      <button type="button" onClick={cyclePlaybackRate} className="min-w-9 rounded-md bg-white/5 px-1.5 py-1 text-[11px] font-extrabold text-slate-300 hover:bg-white/10 hover:text-amber-300" title="Velocidade de reprodução">
        {playbackRate.toString().replace('.', ',')}x
      </button>
      <a href={src} download="audio-whatsapp.ogg" className="rounded-full p-1.5 text-slate-400 hover:bg-white/5 hover:text-amber-300" title="Baixar áudio">
        <Download className="h-4 w-4" />
      </a>
    </div>
  );
};

const DocumentMessageContent: React.FC<{
  message: Message;
  source: string | null;
  loading: boolean;
  canLoadSource: boolean;
  onLoadSource: () => void;
  onOpenViewer: (item: MediaViewerItem, trigger: HTMLElement) => void;
  onLayoutChange?: (reason: string, messageId: string) => void;
}> = ({ message, source, loading, canLoadSource, onLoadSource, onOpenViewer, onLayoutChange }) => {
  const [openRequested, setOpenRequested] = useState(false);
  const presentation = getDocumentPresentation(message);
  const Icon = presentation.kind === 'pdf'
    ? FileText
    : presentation.kind === 'spreadsheet'
      ? FileSpreadsheet
      : presentation.kind === 'archive'
        ? FileArchive
        : presentation.kind === 'word' || presentation.kind === 'text'
          ? FileText
          : File;
  const humanMetadata = presentation.kind === 'pdf'
    ? ['PDF', presentation.formattedSize].filter(Boolean).join(' · ')
    : [presentation.extension, presentation.formattedSize].filter(Boolean).join(' · ');

  useEffect(() => {
    if (!openRequested || !source) return;
    const item = mediaViewerItemFrom(message, source);
    if (item) onOpenViewer(item, document.activeElement as HTMLElement);
    setOpenRequested(false);
  }, [message, onOpenViewer, openRequested, source]);

  useEffect(() => {
    if (source) onLayoutChange?.('document.source.ready', message.id);
  }, [message.id, onLayoutChange, source]);

  const openPreview = (trigger: HTMLElement) => {
    const item = mediaViewerItemFrom(message, source);
    if (item) {
      onOpenViewer(item, trigger);
      return;
    }
    if (!loading && canLoadSource) {
      setOpenRequested(true);
      onLoadSource();
    }
  };

  const downloadAction = source ? (
    <a href={source} download={presentation.fileName} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-bold text-amber-300 transition-colors hover:bg-white/5 hover:text-amber-200">
      <Download className="h-3.5 w-3.5" /> Baixar
    </a>
  ) : canLoadSource ? (
    <button type="button" onClick={onLoadSource} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-bold text-amber-300 transition-colors hover:bg-white/5 hover:text-amber-200 disabled:cursor-wait disabled:text-slate-400">
      {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {loading ? 'Preparando...' : 'Baixar'}
    </button>
  ) : <span className="text-[11px] font-semibold text-slate-500">Arquivo indisponível</span>;

  if (presentation.kind === 'pdf') {
    return (
      <div className="my-1 w-[320px] max-w-[58vw] overflow-hidden rounded-xl border border-white/10 bg-black/25 shadow-inner">
        <button type="button" onClick={(event) => openPreview(event.currentTarget)} className="flex h-28 w-full items-center justify-center bg-gradient-to-br from-red-100 via-white to-slate-200 text-left transition-opacity hover:opacity-90" title="Abrir PDF">
          <span className="flex h-16 w-12 flex-col items-center justify-center rounded-md border border-red-300/60 bg-white text-red-500 shadow-sm"><FileText className="h-6 w-6" /><span className="mt-1 text-[9px] font-extrabold">PDF</span></span>
        </button>
        <div className="flex items-center gap-2.5 border-t border-white/10 px-3 py-2.5">
          <span className="flex h-8 w-7 flex-shrink-0 items-center justify-center rounded bg-red-500/15 text-red-300"><FileText className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-slate-100">{presentation.fileName}</span><span className="mt-0.5 block text-[10px] font-semibold text-slate-400">{humanMetadata}</span></span>
          {downloadAction}
        </div>
      </div>
    );
  }

  return (
    <div className="my-1 flex w-[320px] max-w-[58vw] items-center gap-3 rounded-xl border border-white/10 bg-black/25 px-3 py-3 shadow-inner">
      <span className="flex h-11 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300"><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-slate-100">{presentation.fileName}</span><span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{humanMetadata}</span></span>
      {downloadAction}
    </div>
  );
};

const MediaMessageContent: React.FC<{
  message: Message;
  instanceName: string;
  onOpenViewer: (item: MediaViewerItem, trigger: HTMLElement) => void;
  onLayoutChange?: (reason: string, messageId: string) => void;
}> = ({ message, instanceName, onOpenViewer, onLayoutChange }) => {
  const isMedia = ['image', 'audio', 'video', 'document', 'sticker'].includes(message.mediaType || '');
  if (!isMedia) return null;

  const isDataUri = (url?: string | null) => !!url && url.startsWith('data:');
  const isDocument = message.mediaType === 'document';
  const isReusableDocumentUrl = isDocument
    && !message.rawKey
    && /^https?:\/\//i.test(message.mediaUrl || '');
  const [src, setSrc] = useState<string | null>(isDataUri(message.mediaUrl) || isReusableDocumentUrl ? message.mediaUrl! : null);
  const [documentSourceRequested, setDocumentSourceRequested] = useState(!isDocument);
  const shouldLoadMedia = !isDocument || documentSourceRequested;
  const [loadingMedia, setLoadingMedia] = useState(shouldLoadMedia && !isDataUri(message.mediaUrl) && !!message.rawKey);

  useEffect(() => {
    if (!shouldLoadMedia || !message.rawKey || src) return;
    let mounted = true;
    if (!src) setLoadingMedia(true);
    EvolutionApiService.getDecodedMedia(instanceName, message.rawKey).then((base64) => {
      if (!mounted) return;
      if (base64) setSrc(base64);
      setLoadingMedia(false);
    });
    return () => { mounted = false; };
  }, [instanceName, message.id, message.rawKey, shouldLoadMedia, src]);

  if (message.mediaType === 'document') {
    return <DocumentMessageContent message={message} source={src} loading={loadingMedia} canLoadSource={Boolean(message.rawKey)} onLoadSource={() => setDocumentSourceRequested(true)} onOpenViewer={onOpenViewer} onLayoutChange={onLayoutChange} />;
  }

  if (loadingMedia) {
    const mediaPlaceholderClass = message.mediaType === 'image'
      ? 'h-48 w-72'
      : message.mediaType === 'sticker'
        ? 'h-40 w-40'
        : 'min-h-16 w-[310px] max-w-[58vw]';
    return <div className={`my-1 flex items-center justify-center gap-2 rounded-lg border border-amber-400/20 bg-black/30 p-2.5 text-[11px] font-bold text-amber-300 ${mediaPlaceholderClass}`}><RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-400" /> Descriptografando mídia...</div>;
  }

  if (message.mediaType === 'image') {
    const finalImageSrc = src || (isDataUri(message.mediaUrl) ? message.mediaUrl : null);
    if (!finalImageSrc) return <div className="my-1 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-[11px] text-zinc-400"><ImageIcon className="h-4 w-4 text-zinc-500" /> <span>Imagem indisponível no WhatsApp</span></div>;

    return (
      <>
        <button type="button" onClick={(event) => {
          const item = mediaViewerItemFrom(message, finalImageSrc);
          if (item) onOpenViewer(item, event.currentTarget);
        }} className="group relative mb-2 block max-w-xs overflow-hidden rounded-xl border border-black/20 text-left shadow-xl">
          <img src={finalImageSrc} alt="Imagem WhatsApp" onLoad={() => onLayoutChange?.('image.loaded', message.id)} onError={() => onLayoutChange?.('image.failed', message.id)} className="max-h-72 w-full cursor-pointer rounded-lg object-cover transition-all hover:opacity-90" />
          <div className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-1 text-[10px] font-bold text-white opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100">Clique para ampliar</div>
        </button>
      </>
    );
  }

  if (message.mediaType === 'audio' && src) return <AudioMessagePlayer src={src} durationHint={message.mediaDuration} />;
  if (message.mediaType === 'video' && src) {
    return <div className="max-w-sm overflow-hidden rounded-xl border border-white/10 bg-black/30 shadow-xl"><video src={src} controls preload="metadata" className="max-h-80 w-full bg-black object-contain" aria-label="Vídeo recebido no WhatsApp" /><div className="flex items-center justify-between px-3 py-2"><button type="button" onClick={(event) => { const item = mediaViewerItemFrom(message, src); if (item) onOpenViewer(item, event.currentTarget); }} className="text-[11px] font-bold text-amber-300 hover:text-amber-200">Abrir visualizador</button><a href={src} download="video-whatsapp.mp4" className="text-[11px] font-bold text-amber-300 hover:text-amber-200">Baixar vídeo</a></div></div>;
  }
  if (message.mediaType === 'sticker') return src ? <img src={src} alt="Figurinha do WhatsApp" className="h-40 w-40 object-contain drop-shadow-lg" /> : <div className="text-[11px] text-slate-400">Figurinha indisponível</div>;
  if (message.mediaType === 'audio') return <div className="w-[310px] max-w-[58vw] rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-[11px] text-slate-400">Áudio indisponível para reprodução</div>;
  if (message.mediaType === 'video') return <div className="w-[310px] max-w-[58vw] rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-[11px] text-slate-400">Vídeo indisponível para reprodução</div>;
  return null;
};

export const MessageTimeline = React.memo<MessageTimelineProps>(({ messages, activeConversation, instanceName, containerRef, hasMoreMessages = false, loadingOlderMessages = false, loadingMessages = false, historyExpanded = false, newMessagesCount = 0, onLoadOlder, onJumpToLatest, onRetryMessage, onReplyMessage, onLayoutChange }) => {
  const shouldShowIndicator = newMessagesCount > 0 && Boolean(onJumpToLatest);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [viewerItem, setViewerItem] = useState<MediaViewerItem | null>(null);
  const [openMenuMessageId, setOpenMenuMessageId] = useState<string | null>(null);
  const [messageActionError, setMessageActionError] = useState<string | null>(null);
  const highlightTimeoutRef = React.useRef<number | undefined>();
  const viewerTriggerRef = React.useRef<HTMLElement | null>(null);
  const menuTriggerRef = React.useRef<HTMLButtonElement>(null);
  const actionErrorTimeoutRef = React.useRef<number | undefined>();

  useEffect(() => () => {
    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    if (actionErrorTimeoutRef.current) window.clearTimeout(actionErrorTimeoutRef.current);
  }, []);

  const openQuotedMessage = (messageId: string) => {
    const container = containerRef.current;
    const target = Array.from(container?.querySelectorAll<HTMLElement>('[data-message-id]') || [])
      .find((element) => element.dataset.messageId === messageId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(messageId);
    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightedMessageId(null), 1_600);
  };

  const openMediaViewer = React.useCallback((item: MediaViewerItem, trigger: HTMLElement) => {
    viewerTriggerRef.current = trigger;
    setViewerItem(item);
  }, []);

  const closeMediaViewer = React.useCallback(() => {
    setViewerItem(null);
    window.requestAnimationFrame(() => viewerTriggerRef.current?.focus());
  }, []);

  const showMessageActionError = React.useCallback((messageId: string) => {
    setMessageActionError(messageId);
    if (actionErrorTimeoutRef.current) window.clearTimeout(actionErrorTimeoutRef.current);
    actionErrorTimeoutRef.current = window.setTimeout(() => setMessageActionError(null), 3_000);
  }, []);

  const copyMessage = React.useCallback(async (message: Message) => {
    const text = messageCopyText(message);
    setOpenMenuMessageId(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const fallback = document.createElement('textarea');
        fallback.value = text;
        fallback.setAttribute('readonly', '');
        fallback.style.position = 'fixed';
        fallback.style.opacity = '0';
        document.body.appendChild(fallback);
        fallback.select();
        const copied = document.execCommand('copy');
        fallback.remove();
        if (!copied) throw new Error('copy_failed');
      }
    } catch {
      showMessageActionError(message.id);
    }
  }, [showMessageActionError]);

  const downloadMessage = React.useCallback(async (message: Message) => {
    setOpenMenuMessageId(null);
    try {
      const directSource = message.mediaUrl?.startsWith('data:') ? message.mediaUrl : undefined;
      const decodedSource = !directSource && message.rawKey
        ? await EvolutionApiService.getDecodedMedia(instanceName, message.rawKey)
        : undefined;
      const source = directSource || decodedSource || message.mediaUrl;
      if (!source) throw new Error('media_unavailable');
      const presentation = message.mediaType === 'document' ? getDocumentPresentation(message) : undefined;
      const fileName = presentation?.fileName
        || (message.mediaType === 'image' ? 'imagem-whatsapp.jpg' : message.mediaType === 'video' ? 'video-whatsapp.mp4' : 'arquivo-whatsapp');
      const anchor = document.createElement('a');
      anchor.href = source;
      anchor.download = fileName;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      showMessageActionError(message.id);
    }
  }, [instanceName, showMessageActionError]);

  let previousDay = '';
  return (
  <div className="relative min-h-0 flex-1">
  <div ref={containerRef} style={{ overflowAnchor: 'none' }} className="chat-wallpaper relative h-full space-y-3 overflow-y-auto px-6 py-5 text-[15px]">
    {loadingMessages && <div aria-label="Carregando mensagens" className="pointer-events-none absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center justify-center rounded-full border border-white/10 bg-[#243038]/95 px-3 py-2 shadow-lg"><RefreshCw className="h-4 w-4 animate-spin text-amber-300" /></div>}
    {!loadingMessages && hasMoreMessages && !historyExpanded && onLoadOlder && (
      <div className="flex min-h-[180px] items-center justify-center py-4">
        <button type="button" onClick={onLoadOlder} disabled={loadingOlderMessages} className="rounded-full border border-amber-400/40 bg-amber-400/10 px-5 py-3 text-sm font-bold text-amber-200 shadow-lg transition-colors hover:bg-amber-400/20 disabled:cursor-wait disabled:opacity-60">
          {loadingOlderMessages ? 'Carregando histórico...' : 'Carregar histórico anterior'}
        </button>
      </div>
    )}
    {historyExpanded && hasMoreMessages && onLoadOlder && (
      <div className="flex justify-center py-1">
        <button type="button" onClick={onLoadOlder} disabled={loadingOlderMessages} className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[11px] font-bold text-amber-200 transition-colors hover:bg-amber-400/20 disabled:cursor-wait disabled:opacity-60">
          {loadingOlderMessages ? 'Carregando histórico...' : 'Carregar mensagens anteriores'}
        </button>
      </div>
    )}
    {messages.map((message) => {
      const isMe = message.sender === 'attendant';
      const messageDay = formatMessageDay(message.timestampMs);
      const showDay = Boolean(messageDay && messageDay !== previousDay);
      previousDay = messageDay;
      if (message.isInternalNote) {
        return <React.Fragment key={message.id}>{showDay && <DaySeparator label={messageDay} />}<div className="my-2 flex justify-center"><div className="w-full max-w-xl rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-300"><div className="mb-1 flex items-center gap-1.5 font-bold text-amber-400"><Lock className="h-4 w-4" /><span>Nota Interna ({message.senderName})</span><span className="ml-auto text-xs opacity-70">{formatMessageTimestamp(message.timestampMs, message.timestamp)}</span></div><p>{message.content}</p><span className="mt-1 block text-[10px] font-semibold text-amber-400/70">Invisível para o cliente</span></div></div></React.Fragment>;
      }

      return (
        <React.Fragment key={message.id}>
        {showDay && <DaySeparator label={messageDay} />}
        <div data-message-id={message.id} className={`flex max-w-[78%] gap-2 rounded-xl transition-shadow ${highlightedMessageId === message.id ? 'ring-2 ring-emerald-300/80 ring-offset-2 ring-offset-[#152027]' : ''} ${isMe ? 'ml-auto flex-row-reverse' : ''}`}>
          {!isMe && <ContactPhoto name={activeConversation.contact.name} avatar={activeConversation.contact.avatar} size="small" />}
          <div>
            <div className={`group/message relative space-y-2 rounded-lg px-3.5 py-3 text-[15px] leading-relaxed shadow-sm ${isMe ? 'rounded-tr-none border border-amber-300/15 bg-[#5b4b20] font-medium text-[#fff8df]' : 'rounded-tl-none border border-white/5 bg-[#273238] text-slate-100'}`}>
              <button
                ref={openMenuMessageId === message.id ? menuTriggerRef : undefined}
                type="button"
                aria-label="Abrir ações da mensagem"
                aria-haspopup="menu"
                aria-expanded={openMenuMessageId === message.id}
                onClick={(event) => setOpenMenuMessageId((current) => current === message.id ? null : message.id)}
                className={`absolute top-1 z-20 flex h-6 w-6 items-center justify-center rounded-md bg-black/20 text-slate-300 opacity-55 transition-opacity hover:bg-black/35 hover:text-white md:opacity-0 md:group-hover/message:opacity-100 ${isMe ? 'left-1' : 'right-1'}`}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              {openMenuMessageId === message.id && <MessageActionMenu
                message={message}
                isOpen
                align={isMe ? 'left' : 'right'}
                triggerRef={menuTriggerRef}
                onClose={() => setOpenMenuMessageId(null)}
                onReply={() => { setOpenMenuMessageId(null); onReplyMessage(message); }}
                onCopy={() => void copyMessage(message)}
                onDownload={canDownloadMessageMedia(message) ? () => void downloadMessage(message) : undefined}
              />}
              {isMe && <p className="mb-1 text-xs font-bold text-amber-200/75">{message.metadata?.sentOutsideHub ? 'Enviado fora do Vitstock Hub' : message.senderName}</p>}
              <QuotedMessageBlock message={message} onOpenOriginal={openQuotedMessage} onLayoutChange={onLayoutChange} />
              <MediaMessageContent message={message} instanceName={instanceName} onOpenViewer={openMediaViewer} onLayoutChange={onLayoutChange} />
              <SpecialMessageContent message={message} contactPhone={activeConversation.contact.phone} />
              <InteractiveMessageContent message={message} />
              {!message.metadata?.contactCard && !message.metadata?.location && !message.metadata?.systemLabel && !isMediaPlaceholder(message) && message.content && !message.content.startsWith('[Imagem]') && !message.content.startsWith('[Áudio]') && !message.content.startsWith('[Vídeo]') && <p className="whitespace-pre-wrap">{message.content}</p>}
            </div>
            <div className={`mt-1 flex items-center gap-1 text-xs text-zinc-500 ${isMe ? 'justify-end' : ''}`}>
              <span>{formatMessageTimestamp(message.timestampMs, message.timestamp)}</span>
              {isMe && message.status === 'failed' && <span className="font-bold text-red-300">Falha no envio</span>}
              {isMe && message.status === 'pending' && <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-300" aria-label="Enviando" />}
              {isMe && message.status !== 'failed' && message.status !== 'pending' && <CheckCheck className={`h-3.5 w-3.5 ${message.status === 'read' ? 'text-emerald-400' : message.status === 'delivered' ? 'text-amber-400' : 'text-slate-400'}`} />}
              {isMe && message.status === 'failed' && <button type="button" onClick={() => onRetryMessage(message)} className="ml-1 font-bold text-amber-300 underline decoration-amber-300/50 underline-offset-2 hover:text-amber-200">Tentar novamente</button>}
            </div>
            {messageActionError === message.id && <span className={`mt-1 block text-[11px] font-semibold text-red-300 ${isMe ? 'text-right' : ''}`}>Não foi possível concluir esta ação.</span>}
          </div>
        </div>
        </React.Fragment>
      );
    })}
  </div>
  {viewerItem && <MediaViewer item={viewerItem} onClose={closeMediaViewer} />}
  {shouldShowIndicator && onJumpToLatest && (
    <button
      type="button"
      onClick={onJumpToLatest}
      className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-emerald-300/40 bg-[#1f8f70] px-4 py-2 text-xs font-bold text-white shadow-lg transition-colors hover:bg-[#27a77f]"
    >
      ↓ {newMessagesCount} nova {newMessagesCount === 1 ? 'mensagem' : 'mensagens'}
    </button>
  )}
  </div>
  );
});

const DaySeparator: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex justify-center py-2">
    <span className="rounded-full border border-white/10 bg-[#273238]/90 px-4 py-1.5 text-xs font-bold text-slate-300 shadow-sm">{label}</span>
  </div>
);
