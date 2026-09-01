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

const localCalendarDay = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
const conversationTimeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const conversationWeekdayFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });
const conversationMonthDayFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const conversationFullDateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Formats an inbox conversation timestamp using local calendar-day semantics. */
export const formatConversationTimestamp = (timestampMs: number | undefined, fallback: string, now = new Date()) => {
  if (!timestampMs || !Number.isFinite(timestampMs)) return fallback;
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return fallback;

  const time = conversationTimeFormatter.format(date);
  if (date.getFullYear() !== now.getFullYear()) {
    return `${conversationFullDateFormatter.format(date)} - ${time}`;
  }
  const dayDifference = Math.round((localCalendarDay(now) - localCalendarDay(date)) / 86_400_000);
  if (dayDifference === 0) return time;
  if (dayDifference === 1) return `Ontem - ${time}`;
  if (dayDifference >= 2 && dayDifference <= 6) {
    const weekday = conversationWeekdayFormatter.format(date).replace(/-feira$/, '');
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} - ${time}`;
  }

  return `${conversationMonthDayFormatter.format(date)} - ${time}`;
};

/** Adds the visual punctuation to a Hub operator label without mutating metadata. */
export const formatOperatorLabel = (value?: string | null) => {
  const label = value?.trim() || '';
  if (!label) return '';
  return label.endsWith(':') ? label : `${label}:`;
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
