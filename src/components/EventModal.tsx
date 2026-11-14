import React, { useState } from 'react';
import { Calendar, MapPin, Users, Video, X } from 'lucide-react';
import type { CreateEventInput } from '../types/calendar';
import {
  getUserTimeZone,
  localInputToOffsetIso,
  toLocalDateTimeInputValue,
} from '../lib/dateUtils';

interface EventModalProps {
  isOpen: boolean;
  defaultCalendarId: string;
  onClose: () => void;
  onSubmit: (input: CreateEventInput) => Promise<void>;
}

export const EventModal: React.FC<EventModalProps> = ({
  isOpen,
  defaultCalendarId,
  onClose,
  onSubmit,
}) => {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);
  const plus30 = new Date(nextHour.getTime() + 30 * 60 * 1000);

  const [summary, setSummary] = useState('');
  const [startLocal, setStartLocal] = useState(toLocalDateTimeInputValue(nextHour.toISOString()));
  const [endLocal, setEndLocal] = useState(toLocalDateTimeInputValue(plus30.toISOString()));
  const [attendeesText, setAttendeesText] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [addGoogleMeet, setAddGoogleMeet] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) {
      setError('Please enter a meeting title.');
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      const attendees = attendeesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      await onSubmit({
        calendarId: defaultCalendarId || 'primary',
        summary: summary.trim(),
        startIso: localInputToOffsetIso(startLocal),
        endIso: localInputToOffsetIso(endLocal),
        location: location.trim() || undefined,
        description: description.trim() || undefined,
        attendees: attendees.length > 0 ? attendees : undefined,
        addGoogleMeet,
        timeZone: getUserTimeZone(),
      });
      setSummary('');
      setAttendeesText('');
      setLocation('');
      setDescription('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[1px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-event-modal-title"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h2 id="new-event-modal-title" className="text-base font-semibold text-slate-900">
            Schedule Meeting
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="new-summary" className="block text-xs font-medium text-slate-700 mb-1">
              Meeting Title
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                id="new-summary"
                type="text"
                required
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Quarterly Product Review"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-start" className="block text-xs font-medium text-slate-700 mb-1">
                Start
              </label>
              <input
                id="new-start"
                type="datetime-local"
                required
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label htmlFor="new-end" className="block text-xs font-medium text-slate-700 mb-1">
                End
              </label>
              <input
                id="new-end"
                type="datetime-local"
                required
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="new-attendees"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Attendees (comma-separated emails)
            </label>
            <div className="relative">
              <Users className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                id="new-attendees"
                type="text"
                value={attendeesText}
                onChange={(e) => setAttendeesText(e.target.value)}
                placeholder="colleague@company.com"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="new-location"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Location
            </label>
            <div className="relative">
              <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                id="new-location"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Room 402 or external link"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={addGoogleMeet}
              onChange={(e) => setAddGoogleMeet(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <Video className="w-4 h-4 text-slate-500" />
            <span>Add Google Meet video conference</span>
          </label>

          <div>
            <label htmlFor="new-desc" className="block text-xs font-medium text-slate-700 mb-1">
              Agenda / Notes
            </label>
            <textarea
              id="new-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            {isSaving ? 'Creating...' : 'Create Event'}
          </button>
        </div>
      </form>
    </div>
  );
};
