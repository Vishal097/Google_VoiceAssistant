import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Mic, MicOff, PhoneOff, Settings2 } from 'lucide-react';
import type {
  AssistantMode,
  CalendarEvent,
  CalendarListItem,
  ConfirmationActionType,
  CreateEventInput,
  DailyBriefing,
  LiveModelMode,
  LiveVoiceName,
  PendingConfirmation,
  ToolActivityLog,
  TranscriptMessage,
} from './types/calendar';
import { VoiceAudioPipeline } from './lib/audioPipeline';
import { getDayKey, getEventDurationMinutes, getUserTimeZone } from './lib/dateUtils';
import { VoiceOrbVisualizer } from './components/VoiceOrbVisualizer';
import { ScheduleView, type ScheduleRange } from './components/ScheduleView';
import { VoiceConsole } from './components/VoiceConsole';
import { ConfirmationModal } from './components/ConfirmationModal';
import { EventModal } from './components/EventModal';
import { DailyBriefingPanel } from './components/DailyBriefingPanel';

type ActiveTab = 'schedule' | 'briefing' | 'settings';

export default function App() {
  const timezone = useMemo(() => getUserTimeZone(), []);

  // Navigation & View state
  const [activeTab, setActiveTab] = useState<ActiveTab>('schedule');
  const [range, setRange] = useState<ScheduleRange>('three_days');
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());

  // Calendar data state
  const [calendars, setCalendars] = useState<CalendarListItem[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('primary');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isCalendarLoading, setIsCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  // Briefing state
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [isBriefingLoading, setIsBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);

  // Assistant Mode (Chat OR Voice)
  const [assistantMode, setAssistantMode] = useState<AssistantMode>('chat');
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Voice Live session state
  const [voiceName, setVoiceName] = useState<LiveVoiceName>('Zephyr');
  const [modelMode, setModelMode] = useState<LiveModelMode>('extended');
  const [autoBook, setAutoBook] = useState<boolean>(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [interactionStatus, setInteractionStatus] = useState<'idle' | 'in_progress'>('idle');
  const [audioLevels, setAudioLevels] = useState({
    inputLevel: 0,
    outputLevel: 0,
    isAssistantSpeaking: false,
  });

  // Transcript & Intent pipeline state
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [interimUserText, setInterimUserText] = useState('');
  const [toolLogs, setToolLogs] = useState<ToolActivityLog[]>([]);

  // Modals
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [isConfirmSubmitting, setIsConfirmSubmitting] = useState(false);
  const [isNewEventOpen, setIsNewEventOpen] = useState(false);

  // Refs for WebSocket & Web Audio callbacks (avoid stale closures)
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<VoiceAudioPipeline | null>(null);
  const pendingCommandRef = useRef<string | null>(null);
  const userTranscriptAccRef = useRef('');
  const assistantTranscriptAccRef = useRef('');
  const animFrameRef = useRef<number | null>(null);

  const fetchCalendars = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar/calendars');
      if (!res.ok) return;
      const data = (await res.json()) as { calendars: CalendarListItem[] };
      setCalendars(data.calendars ?? []);
    } catch {
      // Non-fatal fallback
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    setIsCalendarLoading(true);
    setCalendarError(null);
    try {
      const start = new Date(anchorDate);
      start.setHours(0, 0, 0, 0);
      const daysCount = range === 'day' ? 1 : range === 'three_days' ? 3 : 7;
      const end = new Date(start.getTime() + daysCount * 24 * 60 * 60 * 1000);

      const qs = new URLSearchParams({
        calendarId: selectedCalendarId || 'primary',
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        maxResults: '100',
      });

      const res = await fetch(`/api/calendar/events?${qs.toString()}`);
      const data = (await res.json()) as { events?: CalendarEvent[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load calendar events');
      }
      setEvents(data.events ?? []);
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : 'Unable to fetch calendar');
    } finally {
      setIsCalendarLoading(false);
    }
  }, [anchorDate, range, selectedCalendarId]);

  useEffect(() => {
    void fetchCalendars();
  }, [fetchCalendars]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_auto_book', autoBook }));
    }
  }, [autoBook]);

  const appendMessage = useCallback(
    (speaker: 'user' | 'assistant' | 'system', text: string) => {
      const cleaned = text.trim();
      if (!cleaned) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          speaker,
          text: cleaned,
          timestamp: new Date().toISOString(),
        },
      ]);
    },
    [],
  );

  const flushTranscriptBuffers = useCallback(() => {
    if (userTranscriptAccRef.current.trim()) {
      appendMessage('user', userTranscriptAccRef.current);
      userTranscriptAccRef.current = '';
      setInterimUserText('');
    }
    if (assistantTranscriptAccRef.current.trim()) {
      appendMessage('assistant', assistantTranscriptAccRef.current);
      assistantTranscriptAccRef.current = '';
    }
  }, [appendMessage]);

  const stopVoiceSession = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    flushTranscriptBuffers();
    if (audioRef.current) {
      audioRef.current.destroy();
      audioRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setIsMuted(false);
    setInteractionStatus('idle');
    setAudioLevels({ inputLevel: 0, outputLevel: 0, isAssistantSpeaking: false });
  }, [flushTranscriptBuffers]);

  useEffect(() => {
    return () => {
      stopVoiceSession();
    };
  }, [stopVoiceSession]);

  const startVoiceSession = useCallback(
    async (initialTextCommand?: string) => {
      if (isConnected || isConnecting) return;
      setAssistantMode('voice');
      setIsConnecting(true);
      if (initialTextCommand) {
        pendingCommandRef.current = initialTextCommand;
      }

      try {
        const pipeline = new VoiceAudioPipeline();
        pipeline.ensureOutputContext();
        await pipeline.startCapture((base64Pcm) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'audio', data: base64Pcm }));
          }
        });
        audioRef.current = pipeline;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
        wsRef.current = ws;

        const updateLevelsLoop = () => {
          if (audioRef.current) {
            setAudioLevels(audioRef.current.getLevels());
          }
          animFrameRef.current = requestAnimationFrame(updateLevelsLoop);
        };
        animFrameRef.current = requestAnimationFrame(updateLevelsLoop);

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: 'init',
              timezone,
              voiceName,
              mode: modelMode,
              autoBook,
            }),
          );
        };

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data) as {
            type: string;
            data?: string;
            text?: string;
            status?: 'idle' | 'in_progress';
            message?: string;
            activity?: ToolActivityLog;
            confirmation?: PendingConfirmation;
            callId?: string;
          };

          if (msg.type === 'session_ready') {
            setIsConnected(true);
            setIsConnecting(false);
            if (pendingCommandRef.current) {
              const cmd = pendingCommandRef.current;
              pendingCommandRef.current = null;
              appendMessage('user', cmd);
              ws.send(JSON.stringify({ type: 'text', text: cmd }));
            }
            return;
          }

          if (msg.type === 'audio' && msg.data) {
            audioRef.current?.playAudioChunk(msg.data);
            return;
          }

          if (msg.type === 'interrupted') {
            audioRef.current?.interruptPlayback();
            flushTranscriptBuffers();
            return;
          }

          if (msg.type === 'interim_input_transcript' && msg.text) {
            setInterimUserText(msg.text);
            return;
          }

          if (msg.type === 'input_transcript' && msg.text) {
            userTranscriptAccRef.current += msg.text;
            setInterimUserText('');
            if (assistantTranscriptAccRef.current.trim()) {
              appendMessage('assistant', assistantTranscriptAccRef.current);
              assistantTranscriptAccRef.current = '';
            }
            return;
          }

          if (msg.type === 'output_transcript' && msg.text) {
            if (userTranscriptAccRef.current.trim()) {
              appendMessage('user', userTranscriptAccRef.current);
              userTranscriptAccRef.current = '';
              setInterimUserText('');
            }
            assistantTranscriptAccRef.current += msg.text;
            return;
          }

          if (msg.type === 'turn_complete') {
            flushTranscriptBuffers();
            return;
          }

          if (msg.type === 'interaction_status' && msg.status) {
            setInteractionStatus(msg.status);
            if (msg.status === 'idle') {
              flushTranscriptBuffers();
            }
            return;
          }

          if (msg.type === 'tool_activity' && msg.activity) {
            const act = msg.activity;
            setToolLogs((prev) => {
              const existingIdx = prev.findIndex((item) => item.id === act.id);
              if (existingIdx >= 0) {
                const next = [...prev];
                next[existingIdx] = act;
                return next;
              }
              return [...prev, act];
            });
            return;
          }

          if (msg.type === 'confirmation_required' && msg.confirmation) {
            setPendingConfirmation(msg.confirmation);
            return;
          }

          if (msg.type === 'confirmation_cancelled' && msg.callId) {
            setPendingConfirmation((curr) =>
              curr?.callId === msg.callId ? null : curr,
            );
            return;
          }

          if (msg.type === 'calendar_synced') {
            void fetchEvents();
            return;
          }

          if (msg.type === 'error' && msg.message) {
            appendMessage('system', msg.message);
            setIsConnecting(false);
            return;
          }

          if (msg.type === 'session_closed') {
            stopVoiceSession();
          }
        };

        ws.onerror = () => {
          appendMessage('system', 'Voice connection encountered a network error.');
          stopVoiceSession();
        };

        ws.onclose = () => {
          stopVoiceSession();
        };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to access microphone or start voice session';
        appendMessage('system', `${message} You can continue using Chat mode.`);
        stopVoiceSession();
      }
    },
    [
      appendMessage,
      autoBook,
      fetchEvents,
      flushTranscriptBuffers,
      isConnected,
      isConnecting,
      modelMode,
      stopVoiceSession,
      timezone,
      voiceName,
    ],
  );

  const handleModeChange = (nextMode: AssistantMode) => {
    if (nextMode === 'chat') {
      if (isConnected || isConnecting) {
        stopVoiceSession();
      }
      setAssistantMode('chat');
      return;
    }
    setAssistantMode('voice');
  };

  const handleToggleMute = () => {
    if (!audioRef.current) return;
    const nextMuted = !isMuted;
    audioRef.current.setMuted(nextMuted);
    setIsMuted(nextMuted);
  };

  const sendChatMessage = useCallback(
    async (text: string) => {
      const historySnapshot = messages
        .filter((m): m is TranscriptMessage & { speaker: 'user' | 'assistant' } =>
          m.speaker === 'user' || m.speaker === 'assistant',
        )
        .map((m) => ({ speaker: m.speaker, text: m.text }));

      appendMessage('user', text);
      setIsChatLoading(true);
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            history: historySnapshot,
            timezone,
            autoBook,
          }),
        });
        const data = (await res.json()) as {
          reply?: string;
          toolLogs?: ToolActivityLog[];
          calendarChanged?: boolean;
          pendingConfirmation?: PendingConfirmation | null;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || 'Chat request failed');
        }

        if (data.toolLogs && data.toolLogs.length > 0) {
          setToolLogs((prev) => [...prev, ...data.toolLogs!]);
        }
        if (data.calendarChanged) {
          void fetchEvents();
        }
        if (data.reply) {
          appendMessage('assistant', data.reply);
        }
        if (data.pendingConfirmation) {
          setPendingConfirmation(data.pendingConfirmation);
        }
      } catch (err) {
        appendMessage(
          'system',
          err instanceof Error ? err.message : 'Failed to process chat message',
        );
      } finally {
        setIsChatLoading(false);
      }
    },
    [appendMessage, autoBook, fetchEvents, messages, timezone],
  );

  const handleSendMessage = (text: string) => {
    if (assistantMode === 'voice') {
      if (isConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        appendMessage('user', text);
        wsRef.current.send(JSON.stringify({ type: 'text', text }));
        return;
      }
      // If user is in Voice tab without an active mic call, handle cleanly via Chat API so mic isn't forced
      void sendChatMessage(text);
      return;
    }

    void sendChatMessage(text);
  };

  const handleConfirmDecision = async (editedPayload?: Record<string, unknown>) => {
    if (!pendingConfirmation) return;

    if (pendingConfirmation.source === 'voice') {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'tool_decision',
            callId: pendingConfirmation.callId,
            approved: true,
            editedPayload,
          }),
        );
      }
      setPendingConfirmation(null);
      return;
    }

    if (pendingConfirmation.source === 'chat') {
      setIsConfirmSubmitting(true);
      try {
        const res = await fetch('/api/chat/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approved: true,
            actionType: pendingConfirmation.actionType,
            calendarId: pendingConfirmation.calendarId,
            eventId: pendingConfirmation.eventId,
            payload: { ...pendingConfirmation.payload, ...(editedPayload ?? {}) },
            timezone,
          }),
        });
        const data = (await res.json()) as {
          reply?: string;
          calendarChanged?: boolean;
          activity?: ToolActivityLog;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || 'Failed to apply confirmed action');
        }
        if (data.activity) {
          setToolLogs((prev) => [...prev, data.activity!]);
        }
        if (data.reply) {
          appendMessage('assistant', data.reply);
        }
        if (data.calendarChanged) {
          await fetchEvents();
        }
        setPendingConfirmation(null);
      } catch (err) {
        appendMessage(
          'system',
          err instanceof Error ? err.message : 'Failed to apply confirmed action',
        );
      } finally {
        setIsConfirmSubmitting(false);
      }
      return;
    }

    setIsConfirmSubmitting(true);
    try {
      const calId = pendingConfirmation.calendarId || 'primary';
      const eventId = pendingConfirmation.eventId;

      if (pendingConfirmation.actionType === 'update' && eventId) {
        const res = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            calendarId: calId,
            ...(editedPayload ?? pendingConfirmation.payload),
            timeZone: timezone,
          }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || 'Failed to update event');
        }
      } else if (pendingConfirmation.actionType === 'delete' && eventId) {
        const res = await fetch(
          `/api/calendar/events/${encodeURIComponent(eventId)}?calendarId=${encodeURIComponent(
            calId,
          )}`,
          { method: 'DELETE' },
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || 'Failed to delete event');
        }
      }

      setPendingConfirmation(null);
      await fetchEvents();
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : 'Calendar update failed');
    } finally {
      setIsConfirmSubmitting(false);
    }
  };

  const handleCancelConfirmation = async () => {
    if (!pendingConfirmation) return;

    if (
      pendingConfirmation.source === 'voice' &&
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN
    ) {
      wsRef.current.send(
        JSON.stringify({
          type: 'tool_decision',
          callId: pendingConfirmation.callId,
          approved: false,
        }),
      );
      setPendingConfirmation(null);
      return;
    }

    if (pendingConfirmation.source === 'chat') {
      setPendingConfirmation(null);
      appendMessage('assistant', 'Cancelled — no changes were made to your schedule.');
      return;
    }

    setPendingConfirmation(null);
  };

  const handleManualCreateEvent = async (input: CreateEventInput) => {
    const res = await fetch('/api/calendar/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create event');
    }
    await fetchEvents();
  };

  const openManualConfirmation = (
    actionType: ConfirmationActionType,
    event: CalendarEvent,
  ) => {
    setPendingConfirmation({
      callId: `manual-${Date.now()}`,
      source: 'manual',
      actionType,
      calendarId: event.calendarId || selectedCalendarId || 'primary',
      eventId: event.id,
      title:
        actionType === 'update'
          ? `Edit Event: ${event.summary || '(Untitled)'}`
          : `Delete Event: ${event.summary || '(Untitled)'}`,
      descriptionText:
        actionType === 'update'
          ? 'Review and modify the fields below, then confirm to update this event.'
          : 'Confirm removal of this event from your schedule. This action cannot be undone.',
      payload: {
        summary: event.summary,
        startIso: event.start.dateTime || event.start.date,
        endIso: event.end.dateTime || event.end.date,
        location: event.location,
        description: event.description,
        attendees: (event.attendees ?? []).map((a) => a.email).filter(Boolean),
        timeZone: timezone,
      },
      beforeEvent: event,
    });
  };

  const handleGenerateBriefing = async () => {
    setIsBriefingLoading(true);
    setBriefingError(null);
    try {
      const res = await fetch('/api/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone }),
      });
      const data = (await res.json()) as { briefing?: DailyBriefing; error?: string };
      if (!res.ok || !data.briefing) {
        throw new Error(data.error || 'Failed to generate daily briefing');
      }
      setBriefing(data.briefing);
    } catch (err) {
      setBriefingError(err instanceof Error ? err.message : 'Briefing generation failed');
    } finally {
      setIsBriefingLoading(false);
    }
  };

  const handleNavigateDate = (direction: 'prev' | 'today' | 'next') => {
    if (direction === 'today') {
      setAnchorDate(new Date());
      return;
    }
    const stepDays = range === 'day' ? 1 : range === 'three_days' ? 3 : 7;
    const delta = direction === 'next' ? stepDays : -stepDays;
    setAnchorDate((prev) => new Date(prev.getTime() + delta * 24 * 60 * 60 * 1000));
  };

  // KPI computations
  const todayKey = getDayKey(new Date().toISOString());
  const todaysEvents = useMemo(
    () =>
      events.filter((ev) => {
        const val = ev.start.dateTime || ev.start.date;
        return val ? getDayKey(val) === todayKey : false;
      }),
    [events, todayKey],
  );

  const scheduledHoursToday = useMemo(() => {
    const mins = todaysEvents.reduce((acc, ev) => acc + getEventDurationMinutes(ev), 0);
    return (mins / 60).toFixed(1);
  }, [todaysEvents]);

  const nextUpcomingEvent = useMemo(() => {
    const nowMs = Date.now();
    return events.find((ev) => {
      if (!ev.start.dateTime) return false;
      return new Date(ev.start.dateTime).getTime() >= nowMs;
    });
  }, [events]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element Brand Wordmark */}
          <a
            href="/"
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Cadence
          </a>

          {/* Zone 2: Clean Single-Line Nav Links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
            {(
              [
                { id: 'schedule', label: 'Schedule' },
                { id: 'briefing', label: 'Executive Brief' },
                { id: 'settings', label: 'Voice Settings' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center shrink-0">
            {isConnected ? (
              <button
                type="button"
                onClick={stopVoiceSession}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                <span>End Voice Session</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startVoiceSession()}
                disabled={isConnecting}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>{isConnecting ? 'Connecting...' : 'Start Voice Session'}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Tab Strip */}
      <div className="md:hidden bg-white border-b border-slate-200 px-4 flex items-center gap-5 text-xs font-medium">
        {(
          [
            { id: 'schedule', label: 'Schedule' },
            { id: 'briefing', label: 'Executive Brief' },
            { id: 'settings', label: 'Voice Settings' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`py-2.5 border-b-2 whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'border-blue-600 text-slate-900'
                : 'border-transparent text-slate-500'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* 3-Column Executive KPI Strip */}
        <section
          aria-label="Daily Schedule Overview"
          className="grid grid-cols-1 sm:grid-cols-3 bg-white border border-slate-200 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200"
        >
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-slate-500">Meetings Today</p>
            <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {todaysEvents.length}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-slate-500">Scheduled Hours Today</p>
            <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {scheduledHoursToday}h
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-slate-500">Next Upcoming</p>
            {nextUpcomingEvent && nextUpcomingEvent.start.dateTime ? (
              <div className="mt-1 flex items-baseline gap-2 min-w-0">
                <span className="text-sm font-semibold font-mono tabular-nums text-blue-600 shrink-0">
                  {new Date(nextUpcomingEvent.start.dateTime).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
                <span className="text-sm font-medium text-slate-900 truncate">
                  {nextUpcomingEvent.summary}
                </span>
              </div>
            ) : (
              <p className="mt-1.5 text-sm font-medium text-slate-500">Clear schedule</p>
            )}
          </div>
        </section>

        {/* 3-Column Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Rail: Voice & Chat Controls + Calendars */}
          <aside className="lg:col-span-3 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <VoiceOrbVisualizer
              isConnected={isConnected}
              isConnecting={isConnecting}
              isMuted={isMuted}
              inputLevel={audioLevels.inputLevel}
              outputLevel={audioLevels.outputLevel}
              isAssistantSpeaking={audioLevels.isAssistantSpeaking}
              interactionStatus={interactionStatus}
              onToggleSession={() => {
                if (isConnected) {
                  stopVoiceSession();
                } else {
                  void startVoiceSession();
                }
              }}
            />

            <div className="p-4 space-y-4">
              {/* Quick Interaction Mode Switch */}
              <div>
                <span className="block text-xs font-medium text-slate-600 mb-1">
                  Input Channel
                </span>
                <div className="grid grid-cols-2 gap-1 p-0.5 bg-slate-100 border border-slate-200 rounded-lg">
                  <button
                    type="button"
                    onClick={() => handleModeChange('chat')}
                    className={`inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      assistantMode === 'chat'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Chat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeChange('voice')}
                    className={`inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      assistantMode === 'voice'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Mic className="w-3.5 h-3.5" />
                    <span>Voice</span>
                  </button>
                </div>
              </div>

              {isConnected && (
                <button
                  type="button"
                  onClick={handleToggleMute}
                  className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                    isMuted
                      ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  <span>{isMuted ? 'Unmute Microphone' : 'Mute Microphone'}</span>
                </button>
              )}

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="voice-persona-select"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Voice Persona
                  </label>
                  <select
                    id="voice-persona-select"
                    value={voiceName}
                    disabled={isConnected}
                    onChange={(e) => setVoiceName(e.target.value as LiveVoiceName)}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50 disabled:text-slate-500"
                  >
                    <option value="Zephyr">Zephyr (Balanced & Warm)</option>
                    <option value="Kore">Kore (Clear & Crisp)</option>
                    <option value="Puck">Puck (Conversational)</option>
                    <option value="Charon">Charon (Deep & Calm)</option>
                    <option value="Fenrir">Fenrir (Direct & Executive)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="live-mode-select"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Reasoning Pipeline
                  </label>
                  <select
                    id="live-mode-select"
                    value={modelMode}
                    disabled={isConnected}
                    onChange={(e) => setModelMode(e.target.value as LiveModelMode)}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50 disabled:text-slate-500"
                  >
                    <option value="extended">Executive Reasoning (Multi-step)</option>
                    <option value="fast">Low-Latency Voice (Direct)</option>
                  </select>
                </div>

                <div>
                  <span className="block text-xs font-medium text-slate-600 mb-1">
                    Booking Behavior
                  </span>
                  <div className="grid grid-cols-2 gap-1 p-0.5 bg-slate-100 border border-slate-200 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setAutoBook(true)}
                      className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        autoBook
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Auto-Book
                    </button>
                    <button
                      type="button"
                      onClick={() => setAutoBook(false)}
                      className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        !autoBook
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Confirm First
                    </button>
                  </div>
                </div>
              </div>

              {/* Calendars List */}
              <div className="pt-3 border-t border-slate-200">
                <p className="text-xs font-semibold text-slate-700 mb-2">Active Calendar</p>
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setSelectedCalendarId('all')}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                      selectedCalendarId === 'all'
                        ? 'bg-blue-50 text-blue-900 font-medium'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span className="truncate">All Calendars</span>
                  </button>
                  {calendars.map((cal) => (
                    <button
                      key={cal.id}
                      type="button"
                      onClick={() => setSelectedCalendarId(cal.id)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                        selectedCalendarId === cal.id
                          ? 'bg-blue-50 text-blue-900 font-medium'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="truncate">{cal.summary}</span>
                      {cal.primary && (
                        <span className="text-[11px] text-slate-400 shrink-0">Primary</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          {/* Center Main Viewport */}
          <section className="lg:col-span-5 space-y-6 min-w-0">
            {activeTab === 'schedule' && (
              <ScheduleView
                events={events}
                isLoading={isCalendarLoading}
                error={calendarError}
                anchorDate={anchorDate}
                range={range}
                onRangeChange={setRange}
                onNavigateDate={handleNavigateDate}
                onRefresh={() => void fetchEvents()}
                onNewEvent={() => setIsNewEventOpen(true)}
                onRequestEdit={(ev) => openManualConfirmation('update', ev)}
                onRequestDelete={(ev) => openManualConfirmation('delete', ev)}
              />
            )}

            {activeTab === 'briefing' && (
              <DailyBriefingPanel
                briefing={briefing}
                isLoading={isBriefingLoading}
                error={briefingError}
                onGenerate={() => void handleGenerateBriefing()}
                onDiscussInVoice={(summary) => handleSendMessage(summary)}
              />
            )}

            {activeTab === 'settings' && (
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <div className="flex items-center gap-2.5 pb-4 border-b border-slate-200">
                  <Settings2 className="w-5 h-5 text-slate-700" />
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Voice &amp; Chat Pipeline Preferences
                    </h2>
                    <p className="text-xs text-slate-500">
                      Audio parameters, local timezone, and calendar sync behavior
                    </p>
                  </div>
                </div>

                <dl className="divide-y divide-slate-100 text-sm">
                  <div className="py-3 flex items-center justify-between gap-4">
                    <dt className="text-slate-600">Detected Local Timezone</dt>
                    <dd className="font-mono text-xs text-slate-900">{timezone}</dd>
                  </div>
                  <div className="py-3 flex items-center justify-between gap-4">
                    <dt className="text-slate-600">Input Audio Stream</dt>
                    <dd className="font-mono text-xs text-slate-900">16 kHz · 16-bit PCM Mono</dd>
                  </div>
                  <div className="py-3 flex items-center justify-between gap-4">
                    <dt className="text-slate-600">Output Audio Playback</dt>
                    <dd className="font-mono text-xs text-slate-900">24 kHz · Gapless Queue</dd>
                  </div>
                  <div className="py-3 flex items-center justify-between gap-4">
                    <dt className="text-slate-600">Booking Mode</dt>
                    <dd className="text-xs font-medium text-slate-900">
                      {autoBook ? 'Automatic Instant Booking' : 'Review & Confirm Before Sync'}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </section>

          {/* Right Column: Dual-Mode Chat / Live Voice Transcript & Intent Pipeline */}
          <aside className="lg:col-span-4 min-w-0">
            <VoiceConsole
              assistantMode={assistantMode}
              onModeChange={handleModeChange}
              isVoiceConnected={isConnected}
              isVoiceConnecting={isConnecting}
              isChatLoading={isChatLoading}
              messages={messages}
              interimUserText={interimUserText}
              toolLogs={toolLogs}
              onSendMessage={handleSendMessage}
              onQuickPrompt={handleSendMessage}
              onClearHistory={() => {
                setMessages([]);
                setToolLogs([]);
                setInterimUserText('');
              }}
            />
          </aside>
        </div>
      </main>

      {/* Confirmation Dialog for Manual Edits/Deletes or Confirmation Mode */}
      <ConfirmationModal
        confirmation={pendingConfirmation}
        isSubmitting={isConfirmSubmitting}
        onConfirm={(edited) => void handleConfirmDecision(edited)}
        onCancel={() => void handleCancelConfirmation()}
      />

      {/* Manual Event Creation Modal */}
      <EventModal
        isOpen={isNewEventOpen}
        defaultCalendarId={selectedCalendarId === 'all' ? 'primary' : selectedCalendarId}
        onClose={() => setIsNewEventOpen(false)}
        onSubmit={handleManualCreateEvent}
      />
    </div>
  );
}
