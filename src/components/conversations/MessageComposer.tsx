import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { Paperclip, Send, Zap } from 'lucide-react';

type MessageComposerProps = {
  isInternalNote: boolean;
  quickReplyOpen: boolean;
  activeChatLocked: boolean;
  whatsappConnected: boolean;
  assignedAttendantName?: string;
  sendingMedia: boolean;
  attachmentInputRef: React.RefObject<HTMLInputElement>;
  onSubmit: (event: React.FormEvent) => void;
  onTextChange?: (value: string) => void;
  onToggleInternalNote: (value: boolean) => void;
  onToggleQuickReply: () => void;
  onAttachmentChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onInputPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
};

export type MessageComposerHandle = {
  clear: () => void;
  setText: (value: string) => void;
};

const QUICK_REPLIES = [
  { command: '/proposta', label: 'Proposta Comercial PIX', text: 'Segue a proposta comercial para o lote com 5% de desconto no PIX: R$ 58.995,00.' },
  { command: '/frete', label: 'Prazo de Entrega', text: 'O prazo de entrega para Curitiba é de 2 a 3 dias úteis após a confirmação do pagamento.' },
];

export const MessageComposer = forwardRef<MessageComposerHandle, MessageComposerProps>((props, ref) => {
  const [inputText, setInputText] = useState('');
  const {
  isInternalNote,
  quickReplyOpen,
  activeChatLocked,
  whatsappConnected,
  assignedAttendantName,
  sendingMedia,
  attachmentInputRef,
  onSubmit,
  onTextChange,
  onToggleInternalNote,
  onToggleQuickReply,
  onAttachmentChange,
  onInputPaste,
  } = props;
  useImperativeHandle(ref, () => ({
    clear: () => {
      setInputText('');
      onTextChange?.('');
    },
    setText: (value: string) => {
      setInputText(value);
      onTextChange?.(value);
    },
  }), [onTextChange]);
  return (
  <>
    {quickReplyOpen && (
      <div className="mx-5 space-y-2 rounded-lg border border-amber-400/30 bg-zinc-900 p-3 shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between text-xs font-bold text-amber-400">
          <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Respostas Rápidas</span>
          <button type="button" onClick={onToggleQuickReply} className="text-zinc-500 hover:text-zinc-300">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {QUICK_REPLIES.map((reply) => (
            <button key={reply.command} type="button" onClick={() => { setInputText(reply.text); onTextChange?.(reply.text); onToggleQuickReply(); }} className="rounded border border-zinc-700/60 bg-zinc-800/80 p-2 text-left text-zinc-300 hover:bg-amber-400/20 hover:text-amber-300">
              <span className="block font-bold text-amber-400">{reply.command}</span> {reply.label}
            </button>
          ))}
        </div>
      </div>
    )}

    <form onSubmit={onSubmit} className="border-t border-[#344047] bg-[#20292f] p-4">
      {activeChatLocked && (
        <div className="mb-2 rounded-lg border border-violet-300/20 bg-violet-300/10 px-3 py-2 text-[11px] font-semibold text-violet-200">
          Este atendimento está capturado por {assignedAttendantName || 'outro atendente'}.
        </div>
      )}
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={() => onToggleInternalNote(false)} className={`rounded-md px-3 py-1.5 text-sm font-bold transition-all ${!isInternalNote ? 'bg-amber-400 text-zinc-950 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}>
          💬 Responder
        </button>
        <button type="button" onClick={() => onToggleInternalNote(true)} className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-bold transition-all ${isInternalNote ? 'border border-amber-400/40 bg-amber-400/20 text-amber-400' : 'text-zinc-400 hover:text-zinc-200'}`}>
          🔒 Nota Interna
        </button>
        <button type="button" onClick={onToggleQuickReply} className="ml-auto flex items-center gap-1 rounded border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-sm font-bold text-amber-400 hover:text-amber-300">
          <Zap className="h-3.5 w-3.5" /> Resposta Rápida
        </button>
      </div>

      {!isInternalNote && !whatsappConnected && (
        <div className="mb-2 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-200">
          WhatsApp desconectado. Reconecte o WhatsApp para enviar novas mensagens.
        </div>
      )}

      <div className="flex items-center gap-2">
        <input ref={attachmentInputRef} type="file" accept="image/*,video/*,application/pdf,.doc,.docx" className="hidden" onChange={onAttachmentChange} />
        <button type="button" onClick={() => attachmentInputRef.current?.click()} disabled={activeChatLocked || isInternalNote || sendingMedia || !whatsappConnected} title="Enviar imagem, vídeo ou documento" className="rounded-full bg-transparent p-2.5 text-slate-400 transition-colors hover:bg-[#2a343a] hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40">
          <Paperclip className="h-4 w-4" />
        </button>
        <textarea rows={1} value={inputText} onChange={(event) => { setInputText(event.target.value); onTextChange?.(event.target.value); }} onPaste={onInputPaste} disabled={activeChatLocked || sendingMedia} placeholder={isInternalNote ? 'Digite uma nota interna para a equipe...' : 'Digite sua mensagem para o WhatsApp...'} title={!isInternalNote ? 'Cole uma imagem com Ctrl+V para enviar' : undefined} className={`max-h-32 min-h-12 flex-1 resize-y rounded-2xl border bg-[#2a343a] px-4 py-3 text-base leading-6 text-slate-100 placeholder-slate-400 transition-colors focus:outline-none ${isInternalNote ? 'border-amber-400/50 bg-amber-400/5 focus:border-amber-400' : 'border-transparent focus:border-amber-400/70'}`} />
        <button type="submit" disabled={activeChatLocked || sendingMedia || (!isInternalNote && !whatsappConnected)} className={`flex items-center justify-center rounded-full p-3 font-bold transition-all ${isInternalNote ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400' : 'bg-amber-400 text-zinc-950 shadow-[0_0_12px_rgba(238,187,44,0.3)] hover:bg-amber-300'} disabled:cursor-not-allowed disabled:opacity-40`}>
          <Send className="h-4 w-4" />
        </button>
      </div>
    </form>
  </>
  );
});

MessageComposer.displayName = 'MessageComposer';
