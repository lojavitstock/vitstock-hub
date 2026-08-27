export const outboundErrorMessage = (error: unknown, fallback: string) => {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  const providerMessage = error instanceof Error && error.message.trim() ? error.message.trim() : '';

  if (status === 409 && code === 'conversation_lease_active') {
    return providerMessage || 'A conversa está sendo atendida por outro atendente.';
  }
  if (status === 413) return 'Arquivo excede o limite permitido.';
  if (status === 422) return providerMessage || 'A Evolution rejeitou os dados da mensagem.';
  if (status === 429) return 'Muitas tentativas. Aguarde alguns instantes e tente novamente.';
  if (status === 502) return 'O serviço do WhatsApp está indisponível no momento.';
  return providerMessage || fallback;
};
