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

export const formatMessageDay = (timestampMs: number | undefined) => {
  if (!timestampMs || !Number.isFinite(timestampMs)) return '';
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return '';

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (dayDifference === 0) return 'Hoje';
  if (dayDifference === 1) return 'Ontem';

  const weekday = date.toLocaleDateString('pt-BR', { weekday: 'long' });
  if (dayDifference > 1 && dayDifference < 7) {
    return weekday.charAt(0).toUpperCase() + weekday.slice(1);
  }
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
