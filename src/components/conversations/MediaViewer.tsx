import React, { useEffect, useRef, useState } from 'react';
import { Download, FileWarning, X } from 'lucide-react';
import { isMediaViewerCloseKey, type MediaViewerItem } from '../../utils/mediaViewer';

type MediaViewerProps = {
  item: MediaViewerItem;
  onClose: () => void;
};

const viewerLabel = (item: MediaViewerItem) => (
  item.type === 'image' ? 'Imagem' : item.type === 'video' ? 'Vídeo' : 'PDF'
);

export const MediaViewer: React.FC<MediaViewerProps> = ({ item, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (isMediaViewerCloseKey(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], iframe, video[controls]',
      ) || []).filter((element) => !element.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !dialogRef.current?.contains(active) || (!event.shiftKey && active === last)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  const content = unavailable ? (
    <div className="flex min-h-56 w-full max-w-xl flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-[#20292f] px-6 text-center text-slate-300">
      <FileWarning className="h-8 w-8 text-amber-300" />
      <p className="font-bold">Não foi possível abrir este arquivo.</p>
      <p className="text-sm text-slate-400">A mídia pode ter expirado. Tente baixá-la novamente mais tarde.</p>
    </div>
  ) : item.type === 'image' ? (
    <img src={item.src} alt={item.fileName} onError={() => setUnavailable(true)} className="max-h-[78vh] max-w-full rounded-xl object-contain shadow-2xl" />
  ) : item.type === 'video' ? (
    <video src={item.src} controls preload="metadata" onError={() => setUnavailable(true)} className="max-h-[78vh] max-w-full rounded-xl bg-black shadow-2xl" aria-label="Vídeo do WhatsApp" />
  ) : (
    <iframe title={`Visualização de ${item.fileName}`} src={item.src} onError={() => setUnavailable(true)} className="h-[78vh] w-[min(920px,90vw)] rounded-xl border border-white/10 bg-white shadow-2xl" loading="lazy" />
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md" role="presentation" onKeyDown={(event) => event.stopPropagation()} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`${viewerLabel(item)}: ${item.fileName}`} className="relative flex max-h-[90vh] w-full max-w-5xl flex-col items-center justify-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex w-full items-center justify-between gap-3 text-slate-100">
          <span className="min-w-0 truncate text-sm font-bold">{item.fileName}</span>
          <div className="flex flex-shrink-0 items-center gap-2">
            <a href={item.src} download={item.fileName} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-zinc-950 transition-colors hover:bg-amber-300">
              <Download className="h-4 w-4" /> Baixar
            </a>
            <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Fechar visualizador" className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-zinc-200 transition-colors hover:bg-zinc-700 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        {content}
      </div>
    </div>
  );
};
