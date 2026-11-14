import {
  Behavior,
  FunctionResponseScheduling,
  GoogleGenAI,
  InteractionStatus,
  Modality,
  ThinkingLevel,
  Type,
  type Content,
  type FunctionDeclaration,
  type LiveServerMessage,
  type Part,
  type Session,
} from '@google/genai';
import type { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  CalendarEvent,
  ConfirmationActionType,
  DailyBriefing,
  LiveModelMode,
  LiveVoiceName,
  PendingConfirmation,
  ToolActivityLog,
} from '../src/types/calendar.ts';
import {
  CalendarApiError,
  checkAvailability,
  createEvent,
  deleteEvent,
  getEvent,
  listCalendars,
  listEvents,
  updateEvent,
} from './calendarService.ts';

export const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

interface PendingConfirmationEntry {
  callId: string;
  toolName: string;
  actionType: ConfirmationActionType;
  calendarId: string;
  eventId?: string;
  payload: Record<string, unknown>;
  resolve: (decision: { approved: boolean; editedPayload?: Record<string, unknown> }) => void;
}

function buildToolDeclarations(nonBlocking: boolean): FunctionDeclaration[] {
  const baseDeclarations: FunctionDeclaration[] = [
    {
      name: 'get_current_time',
      description:
        'Returns the exact current local date, time, day of week, and timezone for the user. Call this whenever resolving relative dates like today, tomorrow, or next Tuesday.',
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    },
    {
      name: 'list_calendar_events',
      description:
        'Lists events from the user calendar within an ISO-8601 time range, or searches by keyword. Always use full ISO-8601 timestamps with timezone offset (e.g., 2026-11-14T00:00:00-08:00).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          calendarId: {
            type: Type.STRING,
            description: 'Calendar ID, defaults to "primary" (or "all" for all calendars).',
          },
          timeMinIso: {
            type: Type.STRING,
            description: 'Inclusive lower bound ISO-8601 timestamp with offset.',
          },
          timeMaxIso: {
            type: Type.STRING,
            description: 'Exclusive upper bound ISO-8601 timestamp with offset.',
          },
          query: {
            type: Type.STRING,
            description: 'Optional free-text search query matching summary, description, or attendees.',
          },
          maxResults: {
            type: Type.NUMBER,
            description: 'Max number of events to return (default 25).',
          },
        },
      },
    },
    {
      name: 'check_availability',
      description:
        'Checks conflicts and computes open time slots on the user calendar within a given ISO-8601 time window.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          timeMinIso: {
            type: Type.STRING,
            description: 'Start of the window to inspect in ISO-8601 format with timezone offset.',
          },
          timeMaxIso: {
            type: Type.STRING,
            description: 'End of the window to inspect in ISO-8601 format with timezone offset.',
          },
          durationMinutes: {
            type: Type.NUMBER,
            description: 'Minimum desired meeting duration in minutes (default 30).',
          },
          calendarId: {
            type: Type.STRING,
            description: 'Calendar ID, defaults to "primary".',
          },
        },
        required: ['timeMinIso', 'timeMaxIso'],
      },
    },
    {
      name: 'create_calendar_event',
      description: 'Creates and books a new meeting or event on the calendar.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: 'Concise meeting title.',
          },
          startIso: {
            type: Type.STRING,
            description: 'Meeting start time in ISO-8601 format with timezone offset.',
          },
          endIso: {
            type: Type.STRING,
            description: 'Meeting end time in ISO-8601 format with timezone offset.',
          },
          description: {
            type: Type.STRING,
            description: 'Agenda or meeting notes.',
          },
          location: {
            type: Type.STRING,
            description: 'Physical address, room, or virtual link.',
          },
          attendees: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'List of guest email addresses.',
          },
          addGoogleMeet: {
            type: Type.BOOLEAN,
            description: 'Whether to attach a Google Meet video conference link.',
          },
          calendarId: {
            type: Type.STRING,
            description: 'Calendar ID, defaults to "primary".',
          },
        },
        required: ['summary', 'startIso', 'endIso'],
      },
    },
    {
      name: 'update_calendar_event',
      description:
        'Updates or reschedules an existing calendar event. Always call list_calendar_events first to obtain the exact eventId.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          eventId: {
            type: Type.STRING,
            description: 'The exact calendar event ID to update.',
          },
          calendarId: {
            type: Type.STRING,
            description: 'Calendar ID, defaults to "primary".',
          },
          summary: {
            type: Type.STRING,
            description: 'Updated title if changing.',
          },
          startIso: {
            type: Type.STRING,
            description: 'Updated start time in ISO-8601 format with offset.',
          },
          endIso: {
            type: Type.STRING,
            description: 'Updated end time in ISO-8601 format with offset.',
          },
          description: {
            type: Type.STRING,
            description: 'Updated agenda/description.',
          },
          location: {
            type: Type.STRING,
            description: 'Updated location.',
          },
          attendees: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Updated full list of guest email addresses.',
          },
        },
        required: ['eventId'],
      },
    },
    {
      name: 'delete_calendar_event',
      description:
        'Cancels or deletes an existing calendar event. Always call list_calendar_events first to obtain the exact eventId.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          eventId: {
            type: Type.STRING,
            description: 'The exact calendar event ID to delete.',
          },
          calendarId: {
            type: Type.STRING,
            description: 'Calendar ID, defaults to "primary".',
          },
          reason: {
            type: Type.STRING,
            description: 'Brief reason for cancelling the meeting.',
          },
        },
        required: ['eventId'],
      },
    },
  ];

  if (!nonBlocking) {
    return baseDeclarations;
  }

  return baseDeclarations.map((decl) => ({
    ...decl,
    behavior: Behavior.NON_BLOCKING,
  }));
}

function formatNowForZone(timeZone: string): {
  isoLocal: string;
  humanReadable: string;
  timeZone: string;
} {
  const now = new Date();
  let humanReadable = now.toUTCString();
  try {
    humanReadable = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    }).format(now);
  } catch {
    // Fallback
  }

  return {
    isoLocal: now.toISOString(),
    humanReadable,
    timeZone,
  };
}

function buildSystemInstruction(params: {
  timezone: string;
  autoBook: boolean;
  channel: 'voice' | 'chat';
}): string {
  const nowInfo = formatNowForZone(params.timezone);
  return [
    'You are Cadence, a poised, concise, highly capable personal AI executive assistant.',
    `Current date and time: ${nowInfo.humanReadable} (UTC: ${nowInfo.isoLocal}).`,
    `User local timezone: ${params.timezone}.`,
    'Calendar status: Connected and ready for immediate scheduling.',
    '',
    params.channel === 'voice'
      ? 'Voice Conversation & Scheduling Protocol:'
      : 'Executive Chat & Scheduling Protocol:',
    params.channel === 'voice'
      ? '1. Speak naturally, concisely, and warmly like a sharp chief of staff. Never read raw JSON, markdown symbols, asterisks, or event IDs aloud.'
      : '1. Respond concisely and clearly like a sharp chief of staff. Keep answers structured and scannable without raw JSON or internal event IDs.',
    '2. When discussing dates or times, resolve relative expressions ("today", "tomorrow afternoon", "next Tuesday") relative to the current date/time above and always pass full ISO-8601 timestamps with the user timezone offset when calling calendar tools.',
    '3. Before booking a new meeting, proactively call check_availability or list_calendar_events to verify there are no conflicts.',
    params.autoBook
      ? '4. Instant Booking Mode is enabled: create_calendar_event and update_calendar_event execute immediately on the calendar—confirm the booked or updated time concisely once the tool returns.'
      : '4. Confirmation Mode is enabled: for create_calendar_event, update_calendar_event, or delete_calendar_event, tell the user briefly that a confirmation card is ready on screen for their approval.',
    '5. When a calendar action completes, state the confirmed meeting title, date, and time clearly.',
  ].join('\n');
}

function safeSend(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function executeReadOnlyTool(
  name: string,
  args: Record<string, unknown>,
  timezone: string,
): Promise<{ response: Record<string, unknown>; summary: string }> {
  if (name === 'get_current_time') {
    const nowInfo = formatNowForZone(timezone);
    return {
      response: nowInfo,
      summary: `Checked time (${nowInfo.humanReadable})`,
    };
  }

  if (name === 'list_calendar_events') {
    const events = await listEvents({
      calendarId: (args.calendarId as string) || 'primary',
      timeMin: args.timeMinIso as string | undefined,
      timeMax: args.timeMaxIso as string | undefined,
      q: args.query as string | undefined,
      maxResults: typeof args.maxResults === 'number' ? args.maxResults : 25,
    });
    const compactEvents = events.map((ev) => ({
      id: ev.id,
      summary: ev.summary || '(Untitled)',
      start: ev.start.dateTime || ev.start.date,
      end: ev.end.dateTime || ev.end.date,
      location: ev.location || null,
      hangoutLink: ev.hangoutLink || null,
      attendees: (ev.attendees ?? []).map((a) => a.email),
      status: ev.status,
    }));
    return {
      response: { count: compactEvents.length, events: compactEvents },
      summary: `Retrieved ${compactEvents.length} calendar event${
        compactEvents.length === 1 ? '' : 's'
      }`,
    };
  }

  if (name === 'check_availability') {
    const timeMin = String(args.timeMinIso || new Date().toISOString());
    const timeMax = String(
      args.timeMaxIso || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    );
    const durationMinutes =
      typeof args.durationMinutes === 'number' ? args.durationMinutes : 30;

    const availability = await checkAvailability({
      timeMin,
      timeMax,
      durationMinutes,
      calendarId: (args.calendarId as string) || 'primary',
    });
    return {
      response: availability,
      summary: availability.isWindowCompletelyFree
        ? 'Window is completely open'
        : `Found ${availability.conflictingEvents.length} event(s), ${availability.availableSlots.length} open slot(s)`,
    };
  }

  throw new Error(`Unknown read-only tool: ${name}`);
}

async function executeMutationTool(params: {
  actionType: ConfirmationActionType;
  calendarId: string;
  eventId?: string;
  finalPayload: Record<string, unknown>;
  timezone: string;
  beforeEvent: CalendarEvent | null;
}): Promise<{
  response: Record<string, unknown>;
  summary: string;
  syncedEvent?: CalendarEvent;
  deletedEventId?: string;
}> {
  const { actionType, calendarId, eventId, finalPayload, timezone, beforeEvent } = params;

  if (actionType === 'create') {
    const created = await createEvent({
      calendarId,
      summary: String(finalPayload.summary || 'New Meeting'),
      startIso: String(finalPayload.startIso),
      endIso: String(finalPayload.endIso),
      description: finalPayload.description as string | undefined,
      location: finalPayload.location as string | undefined,
      attendees: Array.isArray(finalPayload.attendees)
        ? (finalPayload.attendees as string[])
        : undefined,
      addGoogleMeet: Boolean(finalPayload.addGoogleMeet),
      timeZone: (finalPayload.timeZone as string) || timezone,
    });
    return {
      syncedEvent: created,
      summary: `Booked "${created.summary}"`,
      response: {
        status: 'confirmed_and_synced',
        event: {
          id: created.id,
          summary: created.summary,
          start: created.start.dateTime || created.start.date,
          end: created.end.dateTime || created.end.date,
          hangoutLink: created.hangoutLink || null,
        },
      },
    };
  }

  if (actionType === 'update' && eventId) {
    const updated = await updateEvent({
      calendarId,
      eventId,
      summary: finalPayload.summary as string | undefined,
      startIso: finalPayload.startIso as string | undefined,
      endIso: finalPayload.endIso as string | undefined,
      description: finalPayload.description as string | undefined,
      location: finalPayload.location as string | undefined,
      attendees: Array.isArray(finalPayload.attendees)
        ? (finalPayload.attendees as string[])
        : undefined,
      timeZone: (finalPayload.timeZone as string) || timezone,
    });
    return {
      syncedEvent: updated,
      summary: `Updated "${updated.summary}"`,
      response: {
        status: 'confirmed_and_updated',
        event: {
          id: updated.id,
          summary: updated.summary,
          start: updated.start.dateTime || updated.start.date,
          end: updated.end.dateTime || updated.end.date,
        },
      },
    };
  }

  if (actionType === 'delete' && eventId) {
    await deleteEvent(calendarId, eventId);
    return {
      deletedEventId: eventId,
      summary: `Removed "${beforeEvent?.summary || 'Event'}"`,
      response: {
        status: 'confirmed_and_deleted',
        deletedEventId: eventId,
        summary: beforeEvent?.summary || 'Event',
      },
    };
  }

  throw new Error('Invalid calendar mutation parameters');
}

export function attachLiveWebSocket(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws/live' });

  wss.on('connection', (clientWs) => {
    let session: Session | null = null;
    let timezone = 'America/Los_Angeles';
    let isExtendedMode = true;
    let autoBook = true;
    let isClosed = false;

    const pendingConfirmations = new Map<string, PendingConfirmationEntry>();

    const cleanupSession = () => {
      isClosed = true;
      for (const [callId, pending] of pendingConfirmations.entries()) {
        pending.resolve({ approved: false });
        pendingConfirmations.delete(callId);
      }
      if (session) {
        try {
          session.close();
        } catch {
          // Ignore close error
        }
        session = null;
      }
    };

    const sendToolResult = (
      callId: string,
      name: string,
      response: Record<string, unknown>,
      interrupt = false,
    ) => {
      if (!session || isClosed) return;
      const fnResponse: {
        id: string;
        name: string;
        response: Record<string, unknown>;
        scheduling?: FunctionResponseScheduling;
      } = {
        id: callId,
        name,
        response,
      };
      if (isExtendedMode) {
        fnResponse.scheduling = interrupt
          ? FunctionResponseScheduling.INTERRUPT
          : FunctionResponseScheduling.WHEN_IDLE;
      }
      session.sendToolResponse({
        functionResponses: [fnResponse],
      });
    };

    const handleToolCall = async (call: {
      id?: string;
      name?: string;
      args?: Record<string, unknown>;
    }) => {
      const callId = call.id || `call-${Date.now()}`;
      const name = call.name || 'unknown';
      const args = call.args ?? {};

      safeSend(clientWs, {
        type: 'tool_activity',
        activity: {
          id: callId,
          name,
          status: 'running',
          summary: `Running ${name.replace(/_/g, ' ')}`,
          timestamp: new Date().toISOString(),
        },
      });

      try {
        if (
          name === 'get_current_time' ||
          name === 'list_calendar_events' ||
          name === 'check_availability'
        ) {
          const result = await executeReadOnlyTool(name, args, timezone);
          sendToolResult(callId, name, result.response);
          safeSend(clientWs, {
            type: 'tool_activity',
            activity: {
              id: callId,
              name,
              status: 'completed',
              summary: result.summary,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        if (
          name === 'create_calendar_event' ||
          name === 'update_calendar_event' ||
          name === 'delete_calendar_event'
        ) {
          const calendarId = (args.calendarId as string) || 'primary';
          const eventId = args.eventId as string | undefined;
          let beforeEvent: CalendarEvent | null = null;

          if ((name === 'update_calendar_event' || name === 'delete_calendar_event') && eventId) {
            beforeEvent = await getEvent(calendarId, eventId);
          }

          const actionType: ConfirmationActionType =
            name === 'create_calendar_event'
              ? 'create'
              : name === 'update_calendar_event'
              ? 'update'
              : 'delete';

          let finalPayload: Record<string, unknown> = args;
          const shouldAskConfirmation = actionType === 'delete' || !autoBook;

          if (shouldAskConfirmation) {
            const title =
              actionType === 'create'
                ? `Confirm New Meeting: ${String(args.summary || 'Untitled Meeting')}`
                : actionType === 'update'
                ? `Confirm Update: ${beforeEvent?.summary || String(args.summary || 'Event')}`
                : `Confirm Cancellation: ${beforeEvent?.summary || 'Event'}`;

            const descriptionText =
              actionType === 'create'
                ? 'Review the parsed meeting intent below and confirm to book it on your schedule.'
                : actionType === 'update'
                ? 'Review the proposed changes to your existing event before applying them.'
                : 'This will remove the event from your schedule.';

            safeSend(clientWs, {
              type: 'tool_activity',
              activity: {
                id: callId,
                name,
                status: 'awaiting_confirmation',
                summary: title,
                timestamp: new Date().toISOString(),
              },
            });

            const decision = await new Promise<{
              approved: boolean;
              editedPayload?: Record<string, unknown>;
            }>((resolve) => {
              pendingConfirmations.set(callId, {
                callId,
                toolName: name,
                actionType,
                calendarId,
                eventId,
                payload: args,
                resolve,
              });

              safeSend(clientWs, {
                type: 'confirmation_required',
                confirmation: {
                  callId,
                  source: 'voice',
                  actionType,
                  calendarId,
                  eventId,
                  title,
                  descriptionText,
                  payload: {
                    summary: args.summary as string | undefined,
                    startIso: args.startIso as string | undefined,
                    endIso: args.endIso as string | undefined,
                    description: args.description as string | undefined,
                    location: args.location as string | undefined,
                    attendees: Array.isArray(args.attendees)
                      ? (args.attendees as string[])
                      : undefined,
                    addGoogleMeet: Boolean(args.addGoogleMeet),
                    timeZone: timezone,
                    reason: args.reason as string | undefined,
                  },
                  beforeEvent,
                },
              });
            });

            if (!decision.approved) {
              sendToolResult(
                callId,
                name,
                { status: 'cancelled_by_user', message: 'User declined this action.' },
                true,
              );
              safeSend(clientWs, {
                type: 'tool_activity',
                activity: {
                  id: callId,
                  name,
                  status: 'cancelled',
                  summary: `Cancelled: ${title}`,
                  timestamp: new Date().toISOString(),
                },
              });
              return;
            }

            finalPayload = { ...args, ...(decision.editedPayload ?? {}) };
          }

          const outcome = await executeMutationTool({
            actionType,
            calendarId,
            eventId,
            finalPayload,
            timezone,
            beforeEvent,
          });

          safeSend(clientWs, {
            type: 'calendar_synced',
            actionType,
            event: outcome.syncedEvent,
            eventId: outcome.deletedEventId,
          });
          sendToolResult(callId, name, outcome.response, shouldAskConfirmation);
          safeSend(clientWs, {
            type: 'tool_activity',
            activity: {
              id: callId,
              name,
              status: 'completed',
              summary: outcome.summary,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        sendToolResult(callId, name, { error: `Unknown tool: ${name}` });
      } catch (err) {
        const message =
          err instanceof CalendarApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Tool execution failed';
        sendToolResult(callId, name, { error: message });
        safeSend(clientWs, {
          type: 'tool_activity',
          activity: {
            id: callId,
            name,
            status: 'error',
            summary: message,
            timestamp: new Date().toISOString(),
          },
        });
      }
    };

    clientWs.on('message', async (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString()) as {
          type: string;
          timezone?: string;
          voiceName?: LiveVoiceName;
          mode?: LiveModelMode;
          autoBook?: boolean;
          data?: string;
          text?: string;
          callId?: string;
          approved?: boolean;
          editedPayload?: Record<string, unknown>;
        };

        if (msg.type === 'init') {
          if (session) {
            try {
              session.close();
            } catch {
              // ignore
            }
            session = null;
          }

          timezone = msg.timezone || 'America/Los_Angeles';
          autoBook = msg.autoBook ?? true;
          const voiceName: LiveVoiceName = msg.voiceName || 'Zephyr';
          const mode: LiveModelMode = msg.mode || 'extended';
          isExtendedMode = mode === 'extended';

          const modelName = isExtendedMode
            ? 'gemini-3.8-live-extended-thinking'
            : 'gemini-3.8-live';

          const liveConfig: Record<string, unknown> = {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            tools: [{ functionDeclarations: buildToolDeclarations(isExtendedMode) }],
            systemInstruction: buildSystemInstruction({
              timezone,
              autoBook,
              channel: 'voice',
            }),
          };

          if (isExtendedMode) {
            liveConfig.thinkingConfig = {
              thinkingLevel: ThinkingLevel.MEDIUM,
            };
          }

          session = await ai.live.connect({
            model: modelName,
            config: liveConfig,
            callbacks: {
              onmessage: (liveMessage: LiveServerMessage) => {
                if (isClosed) return;

                if (liveMessage.setupComplete) {
                  safeSend(clientWs, {
                    type: 'session_ready',
                    model: modelName,
                    voiceName,
                  });
                }

                const content = liveMessage.serverContent;
                if (content) {
                  if (content.interimInputTranscription?.text) {
                    safeSend(clientWs, {
                      type: 'interim_input_transcript',
                      text: content.interimInputTranscription.text,
                    });
                  }
                  if (content.inputTranscription?.text) {
                    safeSend(clientWs, {
                      type: 'input_transcript',
                      text: content.inputTranscription.text,
                    });
                  }
                  if (content.outputTranscription?.text) {
                    safeSend(clientWs, {
                      type: 'output_transcript',
                      text: content.outputTranscription.text,
                    });
                  }
                  for (const part of content.modelTurn?.parts ?? []) {
                    if (part.inlineData?.data) {
                      safeSend(clientWs, {
                        type: 'audio',
                        data: part.inlineData.data,
                      });
                    }
                  }
                  if (content.interrupted) {
                    safeSend(clientWs, { type: 'interrupted' });
                  }
                  if (content.turnComplete) {
                    safeSend(clientWs, { type: 'turn_complete' });
                  }
                  if (content.interactionStatus) {
                    safeSend(clientWs, {
                      type: 'interaction_status',
                      status:
                        content.interactionStatus === InteractionStatus.IN_PROGRESS
                          ? 'in_progress'
                          : 'idle',
                    });
                  }
                }

                if (liveMessage.toolCall?.functionCalls?.length) {
                  for (const call of liveMessage.toolCall.functionCalls) {
                    void handleToolCall(call);
                  }
                }

                if (liveMessage.toolCallCancellation?.ids?.length) {
                  for (const cancelledId of liveMessage.toolCallCancellation.ids) {
                    const pending = pendingConfirmations.get(cancelledId);
                    if (pending) {
                      pending.resolve({ approved: false });
                      pendingConfirmations.delete(cancelledId);
                      safeSend(clientWs, {
                        type: 'confirmation_cancelled',
                        callId: cancelledId,
                      });
                    }
                  }
                }
              },
              onerror: (err: unknown) => {
                const message = err instanceof Error ? err.message : 'Gemini Live session error';
                safeSend(clientWs, { type: 'error', message });
              },
              onclose: () => {
                if (!isClosed) {
                  safeSend(clientWs, { type: 'session_closed' });
                }
              },
            },
          });
          return;
        }

        if (msg.type === 'set_auto_book') {
          autoBook = Boolean(msg.autoBook);
          return;
        }

        if (msg.type === 'audio' && msg.data && session) {
          session.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
          return;
        }

        if (msg.type === 'text' && msg.text && session) {
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: msg.text }] }],
            turnComplete: true,
          });
          return;
        }

        if (msg.type === 'tool_decision' && msg.callId) {
          const pending = pendingConfirmations.get(msg.callId);
          if (pending) {
            pendingConfirmations.delete(msg.callId);
            pending.resolve({
              approved: Boolean(msg.approved),
              editedPayload: msg.editedPayload,
            });
          }
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Live pipeline error';
        safeSend(clientWs, { type: 'error', message });
      }
    });

    clientWs.on('close', cleanupSession);
    clientWs.on('error', cleanupSession);
  });

  return wss;
}

export async function runChatTurn(params: {
  message: string;
  history: Array<{ speaker: 'user' | 'assistant'; text: string }>;
  timezone: string;
  autoBook: boolean;
}): Promise<{
  reply: string;
  toolLogs: ToolActivityLog[];
  calendarChanged: boolean;
  pendingConfirmation: PendingConfirmation | null;
}> {
  const contents: Content[] = params.history
    .filter((m) => m.text.trim().length > 0)
    .slice(-16)
    .map((m) => ({
      role: m.speaker === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }));

  contents.push({
    role: 'user',
    parts: [{ text: params.message }],
  });

  const tools = [{ functionDeclarations: buildToolDeclarations(false) }];
  const systemInstruction = buildSystemInstruction({
    timezone: params.timezone,
    autoBook: params.autoBook,
    channel: 'chat',
  });

  const toolLogs: ToolActivityLog[] = [];
  let calendarChanged = false;
  let pendingConfirmation: PendingConfirmation | null = null;

  for (let step = 0; step < 6; step++) {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents,
      config: {
        systemInstruction,
        tools,
      },
    });

    const candidateContent = response.candidates?.[0]?.content;
    const functionCalls = response.functionCalls;

    if (!functionCalls || functionCalls.length === 0) {
      return {
        reply: (response.text ?? '').trim() || 'Done.',
        toolLogs,
        calendarChanged,
        pendingConfirmation,
      };
    }

    if (candidateContent) {
      contents.push(candidateContent);
    }

    const responseParts: Part[] = [];

    for (const call of functionCalls) {
      const callId = call.id || `chat-call-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const name = call.name || 'unknown';
      const args = (call.args ?? {}) as Record<string, unknown>;

      try {
        if (
          name === 'get_current_time' ||
          name === 'list_calendar_events' ||
          name === 'check_availability'
        ) {
          const result = await executeReadOnlyTool(name, args, params.timezone);
          toolLogs.push({
            id: callId,
            name,
            status: 'completed',
            summary: result.summary,
            timestamp: new Date().toISOString(),
          });
          responseParts.push({
            functionResponse: {
              id: call.id,
              name,
              response: result.response,
            },
          });
          continue;
        }

        if (
          name === 'create_calendar_event' ||
          name === 'update_calendar_event' ||
          name === 'delete_calendar_event'
        ) {
          const calendarId = (args.calendarId as string) || 'primary';
          const eventId = args.eventId as string | undefined;
          let beforeEvent: CalendarEvent | null = null;

          if ((name === 'update_calendar_event' || name === 'delete_calendar_event') && eventId) {
            beforeEvent = await getEvent(calendarId, eventId);
          }

          const actionType: ConfirmationActionType =
            name === 'create_calendar_event'
              ? 'create'
              : name === 'update_calendar_event'
              ? 'update'
              : 'delete';

          const shouldAskConfirmation = actionType === 'delete' || !params.autoBook;

          if (shouldAskConfirmation) {
            const title =
              actionType === 'create'
                ? `Confirm New Meeting: ${String(args.summary || 'Untitled Meeting')}`
                : actionType === 'update'
                ? `Confirm Update: ${beforeEvent?.summary || String(args.summary || 'Event')}`
                : `Confirm Cancellation: ${beforeEvent?.summary || 'Event'}`;

            const descriptionText =
              actionType === 'create'
                ? 'Review the parsed meeting intent below and confirm to book it on your schedule.'
                : actionType === 'update'
                ? 'Review the proposed changes to your existing event before applying them.'
                : 'This will remove the event from your schedule.';

            pendingConfirmation = {
              callId,
              source: 'chat',
              actionType,
              calendarId,
              eventId,
              title,
              descriptionText,
              payload: {
                summary: args.summary as string | undefined,
                startIso: args.startIso as string | undefined,
                endIso: args.endIso as string | undefined,
                description: args.description as string | undefined,
                location: args.location as string | undefined,
                attendees: Array.isArray(args.attendees)
                  ? (args.attendees as string[])
                  : undefined,
                addGoogleMeet: Boolean(args.addGoogleMeet),
                timeZone: params.timezone,
                reason: args.reason as string | undefined,
              },
              beforeEvent,
            };

            toolLogs.push({
              id: callId,
              name,
              status: 'awaiting_confirmation',
              summary: title,
              timestamp: new Date().toISOString(),
            });

            return {
              reply: `I have prepared "${
                beforeEvent?.summary || String(args.summary || 'this event')
              }". Please review and confirm on screen to sync it.`,
              toolLogs,
              calendarChanged,
              pendingConfirmation,
            };
          }

          const outcome = await executeMutationTool({
            actionType,
            calendarId,
            eventId,
            finalPayload: args,
            timezone: params.timezone,
            beforeEvent,
          });
          calendarChanged = true;
          toolLogs.push({
            id: callId,
            name,
            status: 'completed',
            summary: outcome.summary,
            timestamp: new Date().toISOString(),
          });
          responseParts.push({
            functionResponse: {
              id: call.id,
              name,
              response: outcome.response,
            },
          });
          continue;
        }

        responseParts.push({
          functionResponse: {
            id: call.id,
            name,
            response: { error: `Unknown tool: ${name}` },
          },
        });
      } catch (err) {
        const message =
          err instanceof CalendarApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Tool execution failed';
        toolLogs.push({
          id: callId,
          name,
          status: 'error',
          summary: message,
          timestamp: new Date().toISOString(),
        });
        responseParts.push({
          functionResponse: {
            id: call.id,
            name,
            response: { error: message },
          },
        });
      }
    }

    contents.push({
      role: 'user',
      parts: responseParts,
    });
  }

  return {
    reply: 'I completed those schedule checks.',
    toolLogs,
    calendarChanged,
    pendingConfirmation,
  };
}

export async function resolveChatConfirmation(params: {
  approved: boolean;
  actionType: ConfirmationActionType;
  calendarId: string;
  eventId?: string;
  payload: Record<string, unknown>;
  timezone: string;
}): Promise<{
  reply: string;
  calendarChanged: boolean;
  activity: ToolActivityLog;
}> {
  if (!params.approved) {
    return {
      reply: 'Cancelled — no changes were made to your schedule.',
      calendarChanged: false,
      activity: {
        id: `chat-cancel-${Date.now()}`,
        name: `${params.actionType}_calendar_event`,
        status: 'cancelled',
        summary: 'Action cancelled by user',
        timestamp: new Date().toISOString(),
      },
    };
  }

  let beforeEvent: CalendarEvent | null = null;
  if (
    (params.actionType === 'update' || params.actionType === 'delete') &&
    params.eventId
  ) {
    beforeEvent = await getEvent(params.calendarId, params.eventId);
  }

  const outcome = await executeMutationTool({
    actionType: params.actionType,
    calendarId: params.calendarId,
    eventId: params.eventId,
    finalPayload: params.payload,
    timezone: params.timezone,
    beforeEvent,
  });

  const reply =
    params.actionType === 'create'
      ? `Confirmed and booked "${outcome.syncedEvent?.summary || 'Meeting'}" on your calendar.`
      : params.actionType === 'update'
      ? `Updated "${outcome.syncedEvent?.summary || 'Event'}" on your calendar.`
      : `Removed "${beforeEvent?.summary || 'Event'}" from your calendar.`;

  return {
    reply,
    calendarChanged: true,
    activity: {
      id: `chat-confirm-${Date.now()}`,
      name: `${params.actionType}_calendar_event`,
      status: 'completed',
      summary: outcome.summary,
      timestamp: new Date().toISOString(),
    },
  };
}

export async function generateExecutiveBriefing(params: {
  timezone: string;
}): Promise<DailyBriefing> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endWindow = new Date(startOfDay.getTime() + 48 * 60 * 60 * 1000);

  const [calendars, events] = await Promise.all([
    listCalendars().catch(() => []),
    listEvents({
      calendarId: 'all',
      timeMin: startOfDay.toISOString(),
      timeMax: endWindow.toISOString(),
      maxResults: 40,
    }),
  ]);

  const compactSchedule = events.map((ev) => ({
    summary: ev.summary || '(Untitled)',
    start: ev.start.dateTime || ev.start.date,
    end: ev.end.dateTime || ev.end.date,
    location: ev.location || null,
    hangoutLink: ev.hangoutLink || null,
    attendeeCount: ev.attendees?.length ?? 0,
    attendees: (ev.attendees ?? []).slice(0, 6).map((a) => a.displayName || a.email),
  }));

  const prompt = [
    'Generate a concise executive daily briefing.',
    `Current time: ${now.toISOString()}, User timezone: ${params.timezone}.`,
    `Active calendars count: ${calendars.length}.`,
    `Upcoming 48-hour events JSON: ${JSON.stringify(compactSchedule)}`,
  ].join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are Cadence, an executive chief of staff. Analyze the calendar events accurately. Identify real open focus windows between 08:00 and 18:00 local time, detect overlapping conflicts or zero-buffer back-to-back runs, and propose practical preparation notes.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          headline: {
            type: Type.STRING,
            description: 'One concise executive summary sentence about the day ahead.',
          },
          scheduleLoad: {
            type: Type.STRING,
            description: 'Must be one of: Light, Balanced, Heavy, Packed.',
          },
          focusWindows: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start: { type: Type.STRING },
                end: { type: Type.STRING },
                durationMinutes: { type: Type.INTEGER },
              },
              required: ['start', 'end', 'durationMinutes'],
            },
          },
          priorities: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                timeLabel: { type: Type.STRING },
                prepNote: { type: Type.STRING },
              },
              required: ['title', 'timeLabel', 'prepNote'],
            },
          },
          conflictsOrRisks: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          recommendedActions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: [
          'headline',
          'scheduleLoad',
          'focusWindows',
          'priorities',
          'conflictsOrRisks',
          'recommendedActions',
        ],
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  return JSON.parse(rawText) as DailyBriefing;
}
