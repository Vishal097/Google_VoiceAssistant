import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Video,
} from 'lucide-react';
import type { CalendarEvent } from '../types/calendar';
import {
  formatDayHeader,
  formatEventTimeRange,
  getDayKey,
  getEventDurationMinutes,
} from '../lib/dateUtils';

export type ScheduleRange = 'day' | 'three_days' | 'week';

interface ScheduleViewProps {
  events: CalendarEvent[];
  isLoading: boolean;
  error: string | null;
  anchorDate: Date;
  range: ScheduleRange;
  onRangeChange: (range: ScheduleRange) => void;
  onNavigateDate: (direction: 'prev' | 'today' | 'next') => void;
  onRefresh: () => void;
  onNewEvent: () => void;
  onRequestEdit: (event: CalendarEvent) => void;
  onRequestDelete: (event: CalendarEvent) => void;
}

export const ScheduleView: React.FC<ScheduleViewProps> = ({
  events,
  isLoading,
  error,
  anchorDate,
  range,
  onRangeChange,
  onNavigateDate,
  onRefresh,
  onNewEvent,
  onRequestEdit,
  onRequestDelete,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return events;
    return events.filter((ev) => {
      const hay = [
        ev.summary,
        ev.location,
        ev.description,
        ...(ev.attendees ?? []).map((a) => `${a.displayName || ''} ${a.email}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [events, searchQuery]);

  const groupedDays = useMemo(() => {
    const groups = new Map<string, { label: string; items: CalendarEvent[] }>();
    for (const ev of filteredEvents) {
      const startVal = ev.start.dateTime || ev.start.date;
      if (!startVal) continue;
      const key = getDayKey(startVal);
      if (!groups.has(key)) {
        const parsed = ev.start.dateTime
          ? new Date(ev.start.dateTime)
          : new Date(`${ev.start.date}T12:00:00`);
        groups.set(key, {
          label: formatDayHeader(parsed),
          items: [],
        });
      }
      groups.get(key)!.items.push(ev);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredEvents]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center border border-slate-200 rounded-lg bg-white">
            <button
              type="button"
              onClick={() => onNavigateDate('prev')}
              aria-label="Previous period"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-l-lg transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onNavigateDate('today')}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-50 border-x border-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => onNavigateDate('next')}
              aria-label="Next period"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-r-lg transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <span className="text-sm font-semibold text-slate-900 ml-1 whitespace-nowrap">
            {anchorDate.toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter events..."
              aria-label="Filter calendar events"
              className="w-44 sm:w-52 pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 border border-slate-200 rounded-lg">
            {(
              [
                { id: 'day', label: 'Day' },
                { id: 'three_days', label: '3 Days' },
                { id: 'week', label: '7 Days' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onRangeChange(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  range === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Refresh Google Calendar"
            className="p-2 text-slate-600 bg-white border border-slate-200 rounded-lg hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={onNewEvent}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Event</span>
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="px-5 py-3 bg-red-50 border-b border-red-200 text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={onRefresh}
            className="font-medium underline hover:no-underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && events.length === 0 ? (
        <div className="divide-y divide-slate-100">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="px-5 py-4 flex items-center gap-4 animate-pulse">
              <div className="w-32 h-4 bg-slate-200 rounded" />
              <div className="flex-1 space-y-2">
                <div className="w-48 h-4 bg-slate-200 rounded" />
                <div className="w-32 h-3 bg-slate-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : groupedDays.length === 0 ? (
        <div className="py-14 px-6 text-center">
          <p className="text-sm font-medium text-slate-900">
            {searchQuery ? 'No events match your filter' : 'No meetings scheduled in this window'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {searchQuery
              ? 'Try clearing your search filter or switching to a 7-day range.'
              : 'Ask Cadence by voice to book a meeting or click New Event above.'}
          </p>
          {!searchQuery && (
            <button
              type="button"
              onClick={onNewEvent}
              className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Schedule First Event</span>
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-slate-200">
          {groupedDays.map(([dayKey, group]) => (
            <div key={dayKey}>
              <div className="px-5 py-2 bg-slate-50/60 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-700">{group.label}</h3>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {group.items.length} {group.items.length === 1 ? 'event' : 'events'}
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {group.items.map((ev) => {
                  const duration = getEventDurationMinutes(ev);
                  const attendeeCount = ev.attendees?.length ?? 0;

                  return (
                    <div
                      key={ev.id}
                      className="group px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-5 min-w-0">
                        <div className="w-40 shrink-0 pt-0.5">
                          <div className="text-xs font-mono tabular-nums font-medium text-slate-800">
                            {formatEventTimeRange(ev)}
                          </div>
                          {duration > 0 && (
                            <div className="text-xs font-mono tabular-nums text-slate-400 mt-0.5">
                              {duration} min
                            </div>
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900 truncate">
                              {ev.summary || '(Untitled event)'}
                            </p>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                            {attendeeCount > 0 && (
                              <span className="tabular-nums">
                                {attendeeCount} {attendeeCount === 1 ? 'attendee' : 'attendees'}
                              </span>
                            )}
                            {attendeeCount > 0 && (ev.location || ev.hangoutLink) && (
                              <span aria-hidden="true">·</span>
                            )}
                            {ev.location && <span className="truncate max-w-xs">{ev.location}</span>}
                            {ev.location && ev.hangoutLink && <span aria-hidden="true">·</span>}
                            {ev.hangoutLink && (
                              <a
                                href={ev.hangoutLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium"
                              >
                                <Video className="w-3 h-3" />
                                <span>Join Google Meet</span>
                              </a>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <a
                          href={`/api/calendar/events/${encodeURIComponent(
                            ev.id,
                          )}/ics?calendarId=${encodeURIComponent(ev.calendarId || 'primary')}`}
                          download
                          title="Download .ics calendar invite"
                          aria-label={`Download .ics invite for ${ev.summary}`}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        {ev.htmlLink && (
                          <a
                            href={ev.htmlLink}
                            target="_blank"
                            rel="noreferrer"
                            title="Add to Google Calendar"
                            aria-label={`Add ${ev.summary} to Google Calendar`}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => onRequestEdit(ev)}
                          aria-label={`Edit ${ev.summary}`}
                          className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRequestDelete(ev)}
                          aria-label={`Delete ${ev.summary}`}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
