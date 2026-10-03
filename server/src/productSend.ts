import { z } from 'zod';
import { isValidEvolutionTextRecipient } from './evolutionRecipient.js';

export const productSendSchema = z.object({
  productId: z.string().uuid(),
  remoteJid: z.string().trim().min(1).max(160),
  clientMessageId: z.string().trim().min(8).max(160),
}).strict().refine((value) => isValidEvolutionTextRecipient({ remoteJid: value.remoteJid }), {
  message: 'Conversa inválida', path: ['remoteJid'],
});

export type ProductSendSnapshot = {
  productId: string;
  name: string;
  priceCents: number;
  currency: 'BRL';
  imageObjectKey: string;
  imageMimeType: 'image/jpeg' | 'image/png' | 'image/webp';
};

export function productCaption(snapshot: ProductSendSnapshot): string {
  const whole = String(Math.floor(snapshot.priceCents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${snapshot.name}\nR$ ${whole},${String(snapshot.priceCents % 100).padStart(2, '0')}`;
}
