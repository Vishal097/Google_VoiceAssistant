import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CalendarApiError,
  createEvent,
  deleteEvent,
  getEvent,
  listCalendars,
  listEvents,
  updateEvent,
} from './server/calendarService.ts';
import {
  attachLiveWebSocket,
  generateExecutiveBriefing,
  resolveChatConfirmation,
  runChatTurn,
} from './server/liveAssistant.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

function handleApiError(res: express.Response, err: unknown) {
  if (err instanceof CalendarApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: message });
}

function toIcsTimestamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/calendar/calendars', async (_req, res) => {
    try {
      const calendars = await listCalendars();
      res.json({ calendars });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.get('/api/calendar/events', async (req, res) => {
    try {
      const events = await listEvents({
        calendarId: (req.query.calendarId as string) || 'primary',
        timeMin: req.query.timeMin as string | undefined,
        timeMax: req.query.timeMax as string | undefined,
        q: req.query.q as string | undefined,
        maxResults: req.query.maxResults ? Number(req.query.maxResults) : 100,
      });
      res.json({ events });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/calendar/events', async (req, res) => {
    try {
      const event = await createEvent(req.body);
      res.status(201).json({ event });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.patch('/api/calendar/events/:eventId', async (req, res) => {
    try {
      const event = await updateEvent({
        ...req.body,
        eventId: req.params.eventId,
      });
      res.json({ event });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.delete('/api/calendar/events/:eventId', async (req, res) => {
    try {
      const calendarId = (req.query.calendarId as string) || 'primary';
      await deleteEvent(calendarId, req.params.eventId);
      res.status(204).send();
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.get('/api/calendar/events/:eventId/ics', async (req, res) => {
    try {
      const calendarId = (req.query.calendarId as string) || 'primary';
      const ev = await getEvent(calendarId, req.params.eventId);
      const start = ev.start.dateTime || ev.start.date || new Date().toISOString();
      const end = ev.end.dateTime || ev.end.date || start;
      const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Cadence//AI Voice Executive Assistant//EN',
        'BEGIN:VEVENT',
        `UID:${ev.id}@cadence.local`,
        `DTSTAMP:${toIcsTimestamp(new Date().toISOString())}`,
        `DTSTART:${toIcsTimestamp(start)}`,
        `DTEND:${toIcsTimestamp(end)}`,
        `SUMMARY:${(ev.summary || 'Meeting').replace(/\n/g, ' ')}`,
        ev.description ? `DESCRIPTION:${ev.description.replace(/\n/g, '\\n')}` : '',
        ev.location ? `LOCATION:${ev.location.replace(/\n/g, ' ')}` : '',
        'END:VEVENT',
        'END:VCALENDAR',
      ]
        .filter(Boolean)
        .join('\r\n');

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${(ev.summary || 'event').replace(/[^a-z0-9-_]+/gi, '_')}.ics"`,
      );
      res.send(lines);
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/briefing', async (req, res) => {
    try {
      const briefing = await generateExecutiveBriefing({
        timezone: req.body?.timezone || 'America/Los_Angeles',
      });
      res.json({ briefing });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const message = String(req.body?.message || '').trim();
      if (!message) {
        res.status(400).json({ error: 'Message is required' });
        return;
      }
      const result = await runChatTurn({
        message,
        history: Array.isArray(req.body?.history) ? req.body.history : [],
        timezone: req.body?.timezone || 'America/Los_Angeles',
        autoBook: req.body?.autoBook ?? true,
      });
      res.json(result);
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/chat/confirm', async (req, res) => {
    try {
      const result = await resolveChatConfirmation({
        approved: Boolean(req.body?.approved),
        actionType: req.body?.actionType,
        calendarId: req.body?.calendarId || 'primary',
        eventId: req.body?.eventId,
        payload: req.body?.payload || {},
        timezone: req.body?.timezone || 'America/Los_Angeles',
      });
      res.json(result);
    } catch (err) {
      handleApiError(res, err);
    }
  });

  const httpServer = http.createServer(app);
  attachLiveWebSocket(httpServer);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Cadence server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Cadence server:', err);
  process.exit(1);
});
