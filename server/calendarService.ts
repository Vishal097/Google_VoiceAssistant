import fs from 'fs';
import path from 'path';
import type {
  CalendarEvent,
  CalendarListItem,
  CreateEventInput,
  UpdateEventInput,
} from '../src/types/calendar.ts';

export class CalendarApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CalendarApiError';
    this.status = status;
  }
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'calendar-store.json');

interface StoreShape {
  calendars: CalendarListItem[];
  events: CalendarEvent[];
}

function formatGoogleCalendarTemplateUrl(ev: CalendarEvent): string {
  const start = ev.start.dateTime || ev.start.date || '';
  const end = ev.end.dateTime || ev.end.date || '';
  const toGCalDate = (iso: string) =>
    new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.summary || 'Meeting',
  });
  if (start && end) {
    params.set('dates', `${toGCalDate(start)}/${toGCalDate(end)}`);
  }
  if (ev.description) params.set('details', ev.description);
  if (ev.location) params.set('location', ev.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function makeSeedTime(dayOffset: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
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

function createDefaultStore(): StoreShape {
  const calendars: CalendarListItem[] = [
    {
      id: 'primary',
      summary: 'Executive Schedule',
      description: 'Primary leadership & client meetings',
      primary: true,
      backgroundColor: '#2563EB',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
      accessRole: 'owner',
    },
    {
      id: 'product-eng',
      summary: 'Product & Engineering',
      description: 'Sprint reviews, architecture & design syncs',
      primary: false,
      backgroundColor: '#0F766E',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
      accessRole: 'owner',
    },
  ];

  const seedEvents: CalendarEvent[] = [
    {
      id: 'evt-seed-1',
      calendarId: 'primary',
      summary: 'Morning Leadership Standup',
      description: 'Review weekly KPIs, unblock product launches, and align on client priorities.',
      location: 'Executive Boardroom · Google Meet',
      hangoutLink: 'https://meet.google.com/cadence-standup',
      status: 'confirmed',
      start: { dateTime: makeSeedTime(0, 9, 30) },
      end: { dateTime: makeSeedTime(0, 10, 0) },
      attendees: [
        { email: 'sarah.chen@company.com', displayName: 'Sarah Chen', responseStatus: 'accepted' },
        { email: 'marcus.lee@company.com', displayName: 'Marcus Lee', responseStatus: 'accepted' },
      ],
    },
    {
      id: 'evt-seed-2',
      calendarId: 'primary',
      summary: 'Q4 Architecture & Voice AI Review',
      description: 'Evaluate latency benchmarks and rollout timeline for voice pipeline.',
      location: 'Room 402',
      status: 'confirmed',
      start: { dateTime: makeSeedTime(0, 11, 0) },
      end: { dateTime: makeSeedTime(0, 12, 0) },
      attendees: [
        { email: 'elena.rodriguez@company.com', displayName: 'Elena Rodriguez', responseStatus: 'accepted' },
      ],
    },
    {
      id: 'evt-seed-3',
      calendarId: 'primary',
      summary: 'Partner Sync: Meridian Ventures',
      description: 'Quarterly roadmap update and strategic partnership check-in.',
      hangoutLink: 'https://meet.google.com/cadence-partner',
      status: 'confirmed',
      start: { dateTime: makeSeedTime(0, 14, 30) },
      end: { dateTime: makeSeedTime(0, 15, 15) },
      attendees: [
        { email: 'david.park@meridian.vc', displayName: 'David Park', responseStatus: 'tentative' },
      ],
    },
    {
      id: 'evt-seed-4',
      calendarId: 'primary',
      summary: 'Design Critique: Mobile Companion',
      description: 'Walk through updated typography, contrast ratios, and voice controls.',
      location: 'Studio B',
      status: 'confirmed',
      start: { dateTime: makeSeedTime(1, 10, 0) },
      end: { dateTime: makeSeedTime(1, 10, 45) },
      attendees: [
        { email: 'priya.nair@company.com', displayName: 'Priya Nair', responseStatus: 'accepted' },
      ],
    },
    {
      id: 'evt-seed-5',
      calendarId: 'product-eng',
      summary: 'Engineering Sprint Planning',
      description: 'Scope next two-week sprint tickets and assign owners.',
      hangoutLink: 'https://meet.google.com/cadence-sprint',
      status: 'confirmed',
      start: { dateTime: makeSeedTime(1, 13, 30) },
      end: { dateTime: makeSeedTime(1, 14, 30) },
      attendees: [
        { email: 'eng-leads@company.com', displayName: 'Engineering Leads', responseStatus: 'accepted' },
      ],
    },
  ];

  for (const ev of seedEvents) {
    ev.htmlLink = formatGoogleCalendarTemplateUrl(ev);
  }

  return { calendars, events: seedEvents };
}

function readStore(): StoreShape {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      const initial = createDefaultStore();
      writeStore(initial);
      return initial;
    }
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StoreShape;
    if (!Array.isArray(parsed.events) || !Array.isArray(parsed.calendars)) {
      const initial = createDefaultStore();
      writeStore(initial);
      return initial;
    }
    return parsed;
  } catch {
    return createDefaultStore();
  }
}

function writeStore(store: StoreShape): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist calendar store:', err);
  }
}

export async function listCalendars(): Promise<CalendarListItem[]> {
  return readStore().calendars;
}

export async function listEvents(
  params: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    q?: string;
    maxResults?: number;
  } = {},
): Promise<CalendarEvent[]> {
  const store = readStore();
  const targetCal = params.calendarId;
  const minMs = params.timeMin ? new Date(params.timeMin).getTime() : null;
  const maxMs = params.timeMax ? new Date(params.timeMax).getTime() : null;
  const q = params.q?.trim().toLowerCase() || '';

  let results = store.events.filter((ev) => {
    if (ev.status === 'cancelled') return false;
    if (targetCal && targetCal !== 'all' && (ev.calendarId || 'primary') !== targetCal) {
      return false;
    }
    const sStr = ev.start.dateTime || (ev.start.date ? `${ev.start.date}T00:00:00` : '');
    const eStr = ev.end.dateTime || (ev.end.date ? `${ev.end.date}T23:59:59` : '');
    const sMs = new Date(sStr).getTime();
    const eMs = new Date(eStr).getTime();

    if (minMs !== null && !Number.isNaN(eMs) && eMs <= minMs) return false;
    if (maxMs !== null && !Number.isNaN(sMs) && sMs >= maxMs) return false;

    if (q) {
      const hay = [
        ev.summary,
        ev.description,
        ev.location,
        ...(ev.attendees ?? []).map((a) => `${a.displayName || ''} ${a.email}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  results.sort((a, b) => {
    const aTime = new Date(a.start.dateTime || a.start.date || 0).getTime();
    const bTime = new Date(b.start.dateTime || b.start.date || 0).getTime();
    return aTime - bTime;
  });

  if (params.maxResults && results.length > params.maxResults) {
    results = results.slice(0, params.maxResults);
  }

  return results;
}

export async function getEvent(
  calendarId = 'primary',
  eventId: string,
): Promise<CalendarEvent> {
  const store = readStore();
  const found = store.events.find(
    (ev) => ev.id === eventId && (!calendarId || (ev.calendarId || 'primary') === calendarId),
  ) || store.events.find((ev) => ev.id === eventId);

  if (!found) {
    throw new CalendarApiError(`Event "${eventId}" not found`, 404);
  }
  return found;
}

export async function createEvent(input: CreateEventInput): Promise<CalendarEvent> {
  const store = readStore();
  const calendarId = input.calendarId || 'primary';
  const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const created: CalendarEvent = {
    id,
    calendarId,
    summary: input.summary || 'New Meeting',
    description: input.description || undefined,
    location: input.location || undefined,
    status: 'confirmed',
    start: {
      dateTime: input.startIso,
      timeZone: input.timeZone || undefined,
    },
    end: {
      dateTime: input.endIso,
      timeZone: input.timeZone || undefined,
    },
    attendees: (input.attendees ?? [])
      .map((email) => email.trim())
      .filter(Boolean)
      .map((email) => ({ email, responseStatus: 'needsAction' as const })),
    hangoutLink: input.addGoogleMeet
      ? `https://meet.google.com/cadence-${Math.random().toString(36).slice(2, 6)}`
      : undefined,
  };
  created.htmlLink = formatGoogleCalendarTemplateUrl(created);

  store.events.push(created);
  writeStore(store);
  return created;
}

export async function updateEvent(input: UpdateEventInput): Promise<CalendarEvent> {
  const store = readStore();
  const idx = store.events.findIndex((ev) => ev.id === input.eventId);
  if (idx < 0) {
    throw new CalendarApiError(`Event "${input.eventId}" not found`, 404);
  }

  const existing = store.events[idx];
  const updated: CalendarEvent = {
    ...existing,
    summary: input.summary !== undefined ? input.summary : existing.summary,
    description: input.description !== undefined ? input.description : existing.description,
    location: input.location !== undefined ? input.location : existing.location,
    start:
      input.startIso !== undefined
        ? { dateTime: input.startIso, timeZone: input.timeZone || existing.start.timeZone }
        : existing.start,
    end:
      input.endIso !== undefined
        ? { dateTime: input.endIso, timeZone: input.timeZone || existing.end.timeZone }
        : existing.end,
    attendees:
      input.attendees !== undefined
        ? input.attendees
            .map((email) => email.trim())
            .filter(Boolean)
            .map((email) => ({ email, responseStatus: 'needsAction' as const }))
        : existing.attendees,
  };
  updated.htmlLink = formatGoogleCalendarTemplateUrl(updated);

  store.events[idx] = updated;
  writeStore(store);
  return updated;
}

export async function deleteEvent(
  _calendarId = 'primary',
  eventId: string,
): Promise<void> {
  const store = readStore();
  const idx = store.events.findIndex((ev) => ev.id === eventId);
  if (idx < 0) {
    throw new CalendarApiError(`Event "${eventId}" not found`, 404);
  }
  store.events.splice(idx, 1);
  writeStore(store);
}

export async function checkAvailability(params: {
  timeMin: string;
  timeMax: string;
  durationMinutes?: number;
  calendarId?: string;
}): Promise<{
  isWindowCompletelyFree: boolean;
  conflictingEvents: Array<{
    id: string;
    summary: string;
    start: string;
    end: string;
  }>;
  availableSlots: Array<{
    startIso: string;
    endIso: string;
    durationMinutes: number;
  }>;
}> {
  const events = await listEvents({
    calendarId: params.calendarId || 'primary',
    timeMin: params.timeMin,
    timeMax: params.timeMax,
    maxResults: 100,
  });

  const windowStart = new Date(params.timeMin).getTime();
  const windowEnd = new Date(params.timeMax).getTime();
  const minDurationMs = (params.durationMinutes ?? 30) * 60 * 1000;

  const busyIntervals = events
    .map((ev) => {
      const startStr = ev.start.dateTime || (ev.start.date ? `${ev.start.date}T00:00:00` : '');
      const endStr = ev.end.dateTime || (ev.end.date ? `${ev.end.date}T23:59:59` : '');
      return {
        id: ev.id,
        summary: ev.summary || '(Untitled event)',
        startStr,
        endStr,
        startMs: new Date(startStr).getTime(),
        endMs: new Date(endStr).getTime(),
      };
    })
    .filter(
      (b) =>
        !Number.isNaN(b.startMs) &&
        !Number.isNaN(b.endMs) &&
        b.endMs > windowStart &&
        b.startMs < windowEnd,
    )
    .sort((a, b) => a.startMs - b.startMs);

  const availableSlots: Array<{ startIso: string; endIso: string; durationMinutes: number }> = [];
  let cursor = windowStart;

  for (const busy of busyIntervals) {
    if (busy.startMs > cursor) {
      const gap = busy.startMs - cursor;
      if (gap >= minDurationMs) {
        availableSlots.push({
          startIso: new Date(cursor).toISOString(),
          endIso: new Date(busy.startMs).toISOString(),
          durationMinutes: Math.floor(gap / 60000),
        });
      }
    }
    if (busy.endMs > cursor) {
      cursor = busy.endMs;
    }
  }

  if (windowEnd > cursor && windowEnd - cursor >= minDurationMs) {
    availableSlots.push({
      startIso: new Date(cursor).toISOString(),
      endIso: new Date(windowEnd).toISOString(),
      durationMinutes: Math.floor((windowEnd - cursor) / 60000),
    });
  }

  return {
    isWindowCompletelyFree: busyIntervals.length === 0,
    conflictingEvents: busyIntervals.map((b) => ({
      id: b.id,
      summary: b.summary,
      start: b.startStr,
      end: b.endStr,
    })),
    availableSlots,
  };
}
