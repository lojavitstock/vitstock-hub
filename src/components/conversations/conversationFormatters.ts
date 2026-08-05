export const formatMessageTimestamp = (timestampMs: number | undefined, fallback: string) => {
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
