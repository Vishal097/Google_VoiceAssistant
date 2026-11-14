export interface CalendarListItem {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
  timeZone?: string;
  accessRole?: string;
}

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  self?: boolean;
  organizer?: boolean;
}

export interface CalendarEvent {
  id: string;
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  status?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: CalendarAttendee[];
  organizer?: {
    email?: string;
    displayName?: string;
    self?: boolean;
  };
  creator?: {
    email?: string;
    displayName?: string;
  };
}

export interface CreateEventInput {
  calendarId?: string;
  summary: string;
  startIso: string;
  endIso: string;
  description?: string;
  location?: string;
  attendees?: string[];
  addGoogleMeet?: boolean;
  timeZone?: string;
}

export interface UpdateEventInput {
  calendarId?: string;
  eventId: string;
  summary?: string;
  startIso?: string;
  endIso?: string;
  description?: string;
  location?: string;
  attendees?: string[];
  timeZone?: string;
}

export type ConfirmationActionType = 'create' | 'update' | 'delete';

export type AssistantMode = 'chat' | 'voice';

export interface PendingConfirmation {
  callId: string;
  source: 'voice' | 'chat' | 'manual';
  actionType: ConfirmationActionType;
  calendarId: string;
  eventId?: string;
  title: string;
  descriptionText: string;
  payload: {
    summary?: string;
    startIso?: string;
    endIso?: string;
    description?: string;
    location?: string;
    attendees?: string[];
    addGoogleMeet?: boolean;
    timeZone?: string;
    reason?: string;
  };
  beforeEvent?: CalendarEvent | null;
}

export interface TranscriptMessage {
  id: string;
  speaker: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
  isInterim?: boolean;
}

export interface ToolActivityLog {
  id: string;
  name: string;
  status: 'running' | 'awaiting_confirmation' | 'completed' | 'cancelled' | 'error';
  summary: string;
  timestamp: string;
  details?: string;
}

export interface DailyBriefing {
  headline: string;
  scheduleLoad: 'Light' | 'Balanced' | 'Heavy' | 'Packed';
  focusWindows: Array<{
    start: string;
    end: string;
    durationMinutes: number;
  }>;
  priorities: Array<{
    title: string;
    timeLabel: string;
    prepNote: string;
  }>;
  conflictsOrRisks: string[];
  recommendedActions: string[];
}

export type LiveVoiceName = 'Zephyr' | 'Kore' | 'Puck' | 'Charon' | 'Fenrir';
export type LiveModelMode = 'extended' | 'fast';
