import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

type ProductDialogProps = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
};

export const ProductDialog: React.FC<ProductDialogProps> = ({ title, onClose, children, labelledBy }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const titleId = labelledBy || generatedId;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusInitial = () => (dialogRef.current?.querySelector<HTMLElement>('[data-dialog-autofocus]')
      || dialogRef.current?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))?.focus();
    const frame = window.requestAnimationFrame(focusInitial);
    return () => {
      window.cancelAnimationFrame(frame);
      previouslyFocused?.focus();
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ) || []).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown} className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-[#14191c] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 sm:px-5">
          <h2 id={titleId} className="text-base font-extrabold text-zinc-100">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 overflow-y-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
};
