import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { FileText, Paperclip, Plus, Reply, Send, Smile, X, Zap } from 'lucide-react';
import { Message, QuickReply } from '../../types';
import { quotedMediaLabel, toQuotedMessage } from '../../utils/quotedMessage';
import { insertComposerText } from '../../utils/composerSubmission';
import type { AttachmentDraft } from '../../utils/composerAttachment';
import { filterQuickReplies, findQuickReplyToken, insertQuickReplyAtToken, resolveQuickReplyBody, type QuickReplyContext } from '../../utils/quickReplies';

type MessageComposerProps = {
  isInternalNote: boolean;
  quickReplyOpen: boolean;
  activeChatLocked: boolean;
  whatsappConnected: boolean;
  leaseOwnerName?: string;
  onPullConversation?: () => void;
  pullingConversation?: boolean;
  sendingMedia: boolean;
  attachmentInputRef: React.RefObject<HTMLInputElement>;
  onSubmit: (event: React.FormEvent) => void;
  onTextChange?: (value: string) => void;
  onToggleInternalNote: (value: boolean) => void;
  onToggleQuickReply: () => void;
  quickReplies?: QuickReply[];
  quickReplyContext?: QuickReplyContext;
  onUseQuickReply?: (reply: QuickReply) => void;
  canCreateQuickReply?: boolean;
  onCreateQuickReply?: () => void;
  onAttachmentChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onInputPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  attachmentDrafts?: AttachmentDraft[];
  onRemoveAttachment?: (attachmentId: string) => void;
  onRemoveAllAttachments?: () => void;
  mediaSendProgress?: { current: number; total: number } | null;
  activeConversationId?: string | null;
  replyTo?: Message | null;
  onCancelReply?: () => void;
};

export type MessageComposerHandle = {
  clear: () => void;
  setText: (value: string) => void;
  focus: () => void;
};

const EMOJI_CATEGORIES = [
  { id: 'recent', label: 'Recentes', emojis: [] },
  { id: 'faces', label: 'Rostos', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😎', '🤔', '😭', '😡', '😴', '🤗'] },
  { id: 'people', label: 'Pessoas', emojis: ['👍', '👎', '👏', '🙌', '🙏', '🤝', '💪', '👋', '👌', '✌️', '🤞', '👀', '👨‍💻', '👩‍💼', '🫶', '💅'] },
  { id: 'animals', label: 'Animais', emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐸', '🐵', '🐔', '🦄', '🐝'] },
  { id: 'food', label: 'Comida', emojis: ['🍎', '🍊', '🍋', '🍉', '🍇', '🍓', '🍒', '🥑', '🍕', '🍔', '🍟', '🌮', '🍰', '🍪', '☕', '🍻'] },
  { id: 'activities', label: 'Atividades', emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏆', '🎮', '🎲', '🎵', '🎉', '🔥', '✨', '💯', '🚀'] },
  { id: 'travel', label: 'Viagens', emojis: ['🚗', '🚕', '🚌', '✈️', '🚲', '⛵', '🏖️', '🏝️', '🗺️', '🌍', '🏠', '🗽'] },
  { id: 'objects', label: 'Objetos', emojis: ['📱', '💻', '⌚', '📷', '💡', '📌', '✏️', '📎', '📁', '📄', '🔑', '🎁'] },
  { id: 'symbols', label: 'Símbolos', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '✅', '❌', '⚠️', '❗', '❓', '⭐', '©️'] },
  { id: 'flags', label: 'Bandeiras', emojis: ['🇧🇷', '🇺🇸', '🇵🇹', '🇪🇸', '🇫🇷', '🇮🇹', '🇩🇪', '🇬🇧', '🇯🇵', '🇦🇷', '🇲🇽', '🇨🇦'] },
] as const;

const RECENT_EMOJIS_KEY = 'vitstock:composer:recent-emojis';

const readRecentEmojis = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_EMOJIS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((emoji): emoji is string => typeof emoji === 'string').slice(0, 18) : [];
  } catch {
    return [];
  }
};

const formatAttachmentSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export const MessageComposer = forwardRef<MessageComposerHandle, MessageComposerProps>((props, ref) => {
  const [inputText, setInputText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
  isInternalNote,
  quickReplyOpen,
  activeChatLocked,
  whatsappConnected,
  leaseOwnerName,
  onPullConversation,
  pullingConversation,
  sendingMedia,
  attachmentInputRef,
  onSubmit,
  onTextChange,
  onToggleInternalNote,
  onToggleQuickReply,
  quickReplies = [],
  quickReplyContext,
  onUseQuickReply,
  canCreateQuickReply = false,
  onCreateQuickReply,
  onAttachmentChange,
  onInputPaste,
  attachmentDrafts = [],
  onRemoveAttachment,
  onRemoveAllAttachments,
  mediaSendProgress,
  activeConversationId,
  replyTo,
  onCancelReply,
  } = props;
  const replyPreview = replyTo ? toQuotedMessage(replyTo) : undefined;
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState('faces');
  const [recentEmojis, setRecentEmojis] = useState<string[]>(readRecentEmojis);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const quickReplyPopoverRef = useRef<HTMLDivElement>(null);
  const quickReplyButtonRef = useRef<HTMLButtonElement>(null);
  const [quickReplySearch, setQuickReplySearch] = useState('');
  const [quickReplyCursor, setQuickReplyCursor] = useState(0);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const hasAttachment = attachmentDrafts.length > 0 && !isInternalNote;

  const slashToken = useMemo(
    () => !isInternalNote ? findQuickReplyToken(inputText, quickReplyCursor) : null,
    [inputText, quickReplyCursor, isInternalNote],
  );
  const slashReplies = useMemo(
    () => slashToken ? filterQuickReplies(quickReplies, slashToken.value.slice(1)) : [],
    [quickReplies, slashToken],
  );
  const buttonReplies = useMemo(() => filterQuickReplies(quickReplies, quickReplySearch), [quickReplies, quickReplySearch]);

  useEffect(() => {
    setEmojiOpen(false);
    setQuickReplySearch('');
    setSlashOpen(false);
  }, [activeConversationId, isInternalNote]);

  useEffect(() => {
    setSlashOpen(Boolean(slashToken && slashReplies.length > 0 && !quickReplyOpen));
    setSlashIndex(0);
  }, [quickReplyOpen, slashReplies.length, slashToken?.value]);

  useEffect(() => {
    if (!quickReplyOpen && !slashOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !quickReplyPopoverRef.current?.contains(target) && !quickReplyButtonRef.current?.contains(target)) {
        setSlashOpen(false);
        if (quickReplyOpen) onToggleQuickReply();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setSlashOpen(false);
        if (quickReplyOpen) onToggleQuickReply();
        textareaRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [quickReplyOpen, slashOpen, onToggleQuickReply]);

  const selectQuickReply = (reply: QuickReply, token: ReturnType<typeof findQuickReplyToken> = null) => {
    const textarea = textareaRef.current;
    const start = token?.start ?? textarea?.selectionStart ?? quickReplyCursor;
    const end = token?.end ?? textarea?.selectionEnd ?? start;
    const body = resolveQuickReplyBody(reply.body, quickReplyContext);
    const next = token
      ? insertQuickReplyAtToken(inputText, token, body)
      : insertComposerText({ value: inputText, inserted: body, start, end });
    setInputText(next.value);
    setQuickReplyCursor(next.cursor);
    onTextChange?.(next.value);
    onUseQuickReply?.(reply);
    setSlashOpen(false);
    if (quickReplyOpen) onToggleQuickReply();
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  useEffect(() => {
    if (!emojiOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !emojiPickerRef.current?.contains(target) && !emojiButtonRef.current?.contains(target)) {
        setEmojiOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setEmojiOpen(false);
        textareaRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [emojiOpen]);

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selectionStart = textarea.selectionStart ?? inputText.length;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const next = insertComposerText({ value: inputText, inserted: emoji, start: selectionStart, end: selectionEnd });
    setInputText(next.value);
    onTextChange?.(next.value);
    setRecentEmojis((previous) => {
      const updated = [emoji, ...previous.filter((item) => item !== emoji)].slice(0, 18);
      try {
        window.localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(updated));
      } catch {
        // Recentes são apenas uma conveniência local.
      }
      return updated;
    });
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const selectedEmojiCategory = emojiCategory === 'recent'
    ? { id: 'recent', label: 'Recentes', emojis: recentEmojis }
    : EMOJI_CATEGORIES.find((category) => category.id === emojiCategory) || EMOJI_CATEGORIES[1];
  useImperativeHandle(ref, () => ({
    clear: () => {
      setInputText('');
      setQuickReplyCursor(0);
      onTextChange?.('');
    },
    setText: (value: string) => {
      setInputText(value);
      setQuickReplyCursor(value.length);
      onTextChange?.(value);
    },
    focus: () => textareaRef.current?.focus(),
  }), [onTextChange]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const token = slashToken;
    if (event.key === 'ArrowDown' && slashOpen && slashReplies.length > 0) {
      event.preventDefault();
      setSlashIndex((current) => (current + 1) % slashReplies.length);
      return;
    }
    if (event.key === 'ArrowUp' && slashOpen && slashReplies.length > 0) {
      event.preventDefault();
      setSlashIndex((current) => (current - 1 + slashReplies.length) % slashReplies.length);
      return;
    }
    if (event.key === 'Escape' && (slashOpen || quickReplyOpen)) {
      event.preventDefault();
      setSlashOpen(false);
      if (quickReplyOpen) onToggleQuickReply();
      return;
    }
    if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey && slashOpen && token && slashReplies.length > 0 && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const reply = slashReplies[slashIndex] || slashReplies[0];
      if (reply) selectQuickReply(reply, token);
      return;
    }
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;

    if (event.ctrlKey) {
      event.preventDefault();
      const textarea = event.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const nextValue = `${inputText.slice(0, start)}\n${inputText.slice(end)}`;
      setInputText(nextValue);
      onTextChange?.(nextValue);
      window.requestAnimationFrame(() => {
        textarea.selectionStart = start + 1;
        textarea.selectionEnd = start + 1;
      });
      return;
    }

    if (event.shiftKey) return;
    event.preventDefault();
    if ((!inputText.trim() && !hasAttachment) || activeChatLocked || sendingMedia || (!isInternalNote && !whatsappConnected)) return;
    event.currentTarget.form?.requestSubmit();
  };

  return (
  <>
    <form onSubmit={onSubmit} className="border-t border-[#344047] bg-[#20292f] p-4">
      {replyPreview && !isInternalNote && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border-l-2 border-emerald-300 bg-[#28343a] px-3 py-2 text-left shadow-sm">
          <Reply className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-emerald-200">Respondendo a {replyPreview.authorName || 'mensagem'}</p>
            <p className="truncate text-xs text-slate-300">{quotedMediaLabel(replyPreview.mediaType) || replyPreview.content || 'Mensagem'}</p>
          </div>
          <button type="button" onClick={onCancelReply} className="rounded p-1 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100" title="Cancelar resposta">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {activeChatLocked && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-violet-300/20 bg-violet-300/10 px-3 py-2 text-xs font-semibold text-violet-200">
          <span>Atendimento em andamento por {leaseOwnerName || 'outro atendente'}.</span>
          {onPullConversation && (
            <button type="button" onClick={onPullConversation} disabled={pullingConversation} className="shrink-0 rounded-md border border-violet-300/40 px-2.5 py-1 text-[11px] font-bold text-violet-100 transition-colors hover:bg-violet-300 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60">
              {pullingConversation ? 'Puxando...' : 'Puxar conversa para você'}
            </button>
          )}
        </div>
      )}
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={() => onToggleInternalNote(false)} className={`rounded-md px-3 py-1.5 text-sm font-bold transition-all ${!isInternalNote ? 'bg-amber-400 text-zinc-950 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}>
          💬 Responder
        </button>
        <button type="button" onClick={() => onToggleInternalNote(true)} className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-bold transition-all ${isInternalNote ? 'border border-amber-400/40 bg-amber-400/20 text-amber-400' : 'text-zinc-400 hover:text-zinc-200'}`}>
          🔒 Nota Interna
        </button>
      </div>

      {!isInternalNote && !whatsappConnected && (
        <div className="mb-2 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-200">
          WhatsApp desconectado. Reconecte o WhatsApp para enviar novas mensagens.
        </div>
      )}

      {hasAttachment && (
        <div data-testid="attachment-drafts" className="mb-3 rounded-xl border border-amber-400/30 bg-[#2a343a] p-2.5">
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
            {attachmentDrafts.map((attachment) => (
              <div key={attachment.id} data-testid="attachment-draft" className="relative flex w-28 shrink-0 flex-col gap-1 rounded-lg border border-slate-600/60 bg-[#20292f] p-1.5">
                {attachment.mediaType === 'image' && attachment.previewUrl ? (
                  <img src={attachment.previewUrl} alt={`Prévia de ${attachment.fileName}`} className="h-16 w-full rounded-md object-cover" />
                ) : attachment.mediaType === 'video' && attachment.previewUrl ? (
                  <video src={attachment.previewUrl} controls preload="metadata" className="h-16 w-full rounded-md object-cover" />
                ) : (
                  <div className="flex h-16 w-full items-center justify-center rounded-md bg-red-400/10 text-red-300" aria-hidden="true"><FileText className="h-7 w-7" /></div>
                )}
                <p className="truncate text-[11px] font-semibold text-slate-100" title={attachment.fileName}>{attachment.fileName}</p>
                <p className="truncate text-[10px] text-slate-400">{attachment.mimeType || 'Arquivo'} · {formatAttachmentSize(attachment.size)}</p>
                {attachment.status === 'failed' && <p className="text-[10px] font-semibold text-red-300">Falhou — tente novamente</p>}
                <button type="button" onClick={() => onRemoveAttachment?.(attachment.id)} aria-label={`Remover anexo ${attachment.fileName}`} title="Remover anexo" className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-slate-200 transition-colors hover:bg-red-500/80"><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
          {attachmentDrafts.length > 1 && onRemoveAllAttachments && (
            <button type="button" onClick={onRemoveAllAttachments} className="mt-1 text-[11px] font-semibold text-slate-400 hover:text-red-300">Remover todos</button>
          )}
        </div>
      )}
      {mediaSendProgress && <p className="mb-2 text-xs font-semibold text-amber-200">Enviando {mediaSendProgress.current} de {mediaSendProgress.total}...</p>}

      <div className="relative flex items-center gap-2">
        {(quickReplyOpen || slashOpen) && !isInternalNote && (
          <div ref={quickReplyPopoverRef} role="dialog" aria-label="Mensagens rápidas" className="absolute bottom-full left-0 z-30 mb-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-amber-400/30 bg-[#182126] p-3 shadow-2xl">
            {quickReplyOpen && (
              <>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-300"><Zap className="h-3.5 w-3.5 text-amber-300" /> Respostas rápidas</span>
                  {canCreateQuickReply && onCreateQuickReply && (
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onCreateQuickReply} aria-label="Criar resposta rápida" title="Criar resposta rápida" className="flex h-6 w-6 items-center justify-center rounded-md border border-amber-400/30 text-amber-300 transition-colors hover:border-amber-300 hover:bg-amber-400/10"><Plus className="h-3.5 w-3.5" /></button>
                  )}
                </div>
                <input autoFocus value={quickReplySearch} onChange={(event) => setQuickReplySearch(event.target.value)} placeholder="Buscar atalho, título ou mensagem" aria-label="Buscar mensagens rápidas" className="mb-2 w-full rounded-lg border border-slate-700 bg-[#20292f] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-400" />
              </>
            )}
            <div role="listbox" aria-label="Opções de mensagens rápidas" className="max-h-56 space-y-1 overflow-y-auto">
              {(quickReplyOpen ? buttonReplies : slashReplies).map((reply, index) => (
                <button key={reply.id} type="button" role="option" aria-selected={!quickReplyOpen && index === slashIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => selectQuickReply(reply, slashOpen ? slashToken : null)} className={`block w-full rounded-lg border border-transparent px-3 py-2 text-left text-sm transition-colors hover:border-amber-400/30 hover:bg-amber-400/10 ${!quickReplyOpen && index === slashIndex ? 'border-amber-400/30 bg-amber-400/10' : ''}`}>
                  <span className="mr-2 font-mono font-bold text-amber-300">{reply.shortcut}</span>
                  <span className="font-semibold text-slate-100">{reply.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-400">{reply.body}</span>
                </button>
              ))}
              {((quickReplyOpen ? buttonReplies : slashReplies).length === 0) && (
                quickReplyOpen ? (
                  <div className="py-3 text-center">
                    <p className="text-xs text-slate-500">Nenhuma resposta rápida cadastrada.</p>
                    {canCreateQuickReply && onCreateQuickReply ? (
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onCreateQuickReply} className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-400/30 px-2.5 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-400/10"><Plus className="h-3.5 w-3.5" /> Criar resposta</button>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">Peça a um administrador para cadastrar.</p>
                    )}
                  </div>
                ) : <p className="py-3 text-center text-xs text-slate-500">Nenhuma mensagem rápida encontrada.</p>
              )}
            </div>
          </div>
        )}
        {emojiOpen && !isInternalNote && (
          <div ref={emojiPickerRef} role="dialog" aria-label="Selecionar emoji" className="absolute bottom-full left-0 z-30 mb-2 w-[min(21rem,calc(100vw-2rem))] rounded-xl border border-slate-600 bg-[#182126] p-2 shadow-2xl">
            <div className="mb-2 flex gap-1 overflow-x-auto border-b border-slate-700 pb-2">
              {EMOJI_CATEGORIES.map((category) => (
                <button key={category.id} type="button" title={category.label} aria-label={`Categoria ${category.label}`} onClick={() => setEmojiCategory(category.id)} className={`shrink-0 rounded px-2 py-1 text-xs ${emojiCategory === category.id ? 'bg-amber-400 text-zinc-950' : 'text-slate-400 hover:bg-white/10'}`}>
                  {category.id === 'recent' ? '🕘' : category.emojis[0]}
                </button>
              ))}
            </div>
            <div className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto">
              {selectedEmojiCategory.emojis.map((emoji, index) => (
                <button key={`${emoji}-${index}`} type="button" aria-label={`Inserir emoji ${emoji}`} onClick={() => insertEmoji(emoji)} className="rounded p-1.5 text-xl leading-none hover:bg-white/10">{emoji}</button>
              ))}
              {selectedEmojiCategory.emojis.length === 0 && <span className="col-span-8 py-4 text-center text-xs text-slate-500">Nenhum emoji recente</span>}
            </div>
          </div>
        )}
        {!isInternalNote && (
          <button ref={emojiButtonRef} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { if (quickReplyOpen) onToggleQuickReply(); setEmojiOpen((open) => !open); }} aria-label="Inserir emoji" title="Inserir emoji" className="rounded-full bg-transparent p-2.5 text-slate-400 transition-colors hover:bg-[#2a343a] hover:text-amber-300">
            <Smile className="h-4 w-4" />
          </button>
        )}
        <input ref={attachmentInputRef} type="file" multiple accept="image/*,video/*,application/pdf,.doc,.docx" className="hidden" onChange={onAttachmentChange} />
        <button type="button" onClick={() => attachmentInputRef.current?.click()} disabled={activeChatLocked || isInternalNote || sendingMedia || !whatsappConnected} aria-label="Anexar arquivo" title="Anexar arquivo" className="rounded-full bg-transparent p-2.5 text-slate-400 transition-colors hover:bg-[#2a343a] hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40">
          <Paperclip className="h-4 w-4" />
        </button>
        {!isInternalNote && <button ref={quickReplyButtonRef} type="button" disabled={activeChatLocked || sendingMedia} onMouseDown={(event) => event.preventDefault()} onClick={() => { setEmojiOpen(false); setQuickReplySearch(''); setSlashOpen(false); onToggleQuickReply(); }} aria-label="Mensagens rápidas" title="Mensagens rápidas" className={`shrink-0 rounded-full bg-transparent p-2.5 text-slate-400 transition-colors hover:bg-[#2a343a] hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40 ${quickReplyOpen ? 'text-amber-300' : ''}`}>
          <Zap className="h-4 w-4" />
        </button>}
        <textarea ref={textareaRef} rows={1} value={inputText} onChange={(event) => { setInputText(event.target.value); setQuickReplyCursor(event.target.selectionStart); onTextChange?.(event.target.value); }} onSelect={(event) => setQuickReplyCursor(event.currentTarget.selectionStart)} onKeyDown={handleKeyDown} onPaste={onInputPaste} disabled={activeChatLocked || sendingMedia} placeholder={isInternalNote ? 'Digite uma nota interna para a equipe...' : 'Digite sua mensagem para o WhatsApp...'} title={!isInternalNote ? 'Cole uma imagem com Ctrl+V para enviar' : undefined} className={`max-h-32 min-h-12 flex-1 resize-y rounded-2xl border bg-[#2a343a] px-4 py-3 text-base leading-6 text-slate-100 placeholder-slate-400 transition-colors focus:outline-none ${isInternalNote ? 'border-amber-400/50 bg-amber-400/5 focus:border-amber-400' : 'border-transparent focus:border-amber-400/70'}`} />
        <button type="submit" disabled={activeChatLocked || sendingMedia || (!isInternalNote && !whatsappConnected) || (!inputText.trim() && !hasAttachment)} aria-label="Enviar mensagem" title="Enviar mensagem" className={`flex items-center justify-center rounded-full p-3 font-bold transition-all ${isInternalNote ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400' : 'bg-amber-400 text-zinc-950 shadow-[0_0_12px_rgba(238,187,44,0.3)] hover:bg-amber-300'} disabled:cursor-not-allowed disabled:opacity-40`}>
          <Send className="h-4 w-4" />
        </button>
      </div>
    </form>
  </>
  );
});

MessageComposer.displayName = 'MessageComposer';
