import type { CalendarEvent } from '../types/calendar';

export function getUserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
  } catch {
    return 'America/Los_Angeles';
  }
}

export function formatEventTimeRange(event: CalendarEvent): string {
  if (event.start.date && !event.start.dateTime) {
    return 'All day';
  }
  if (!event.start.dateTime || !event.end.dateTime) {
    return 'Scheduled';
  }
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

export function formatIsoDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function formatDayHeader(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function getDayKey(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr.slice(0, 10);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getEventDurationMinutes(event: CalendarEvent): number {
  if (!event.start.dateTime || !event.end.dateTime) return 0;
  const start = new Date(event.start.dateTime).getTime();
  const end = new Date(event.end.dateTime).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

export function toLocalDateTimeInputValue(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function localInputToOffsetIso(localDateTime: string): string {
  const d = new Date(localDateTime);
  if (Number.isNaN(d.getTime())) return localDateTime;
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMin);
  const hh = String(Math.floor(absMin / 60)).padStart(2, '0');
  const mm = String(absMin % 60).padStart(2, '0');
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:00${sign}${hh}:${mm}`;
}
