import React, { useEffect, useState } from 'react';
import { Calendar, Clock, MapPin, Trash2, Users, Video, X } from 'lucide-react';
import type { PendingConfirmation } from '../types/calendar';
import {
  formatIsoDateTime,
  localInputToOffsetIso,
  toLocalDateTimeInputValue,
} from '../lib/dateUtils';

interface ConfirmationModalProps {
  confirmation: PendingConfirmation | null;
  isSubmitting: boolean;
  onConfirm: (editedPayload?: Record<string, unknown>) => void;
  onCancel: () => void;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  confirmation,
  isSubmitting,
  onConfirm,
  onCancel,
}) => {
  const [summary, setSummary] = useState('');
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [attendeesText, setAttendeesText] = useState('');
  const [addGoogleMeet, setAddGoogleMeet] = useState(false);

  useEffect(() => {
    if (!confirmation) return;
    const p = confirmation.payload;
    const before = confirmation.beforeEvent;
    setSummary(p.summary ?? before?.summary ?? '');
    setStartLocal(
      toLocalDateTimeInputValue(
        p.startIso ?? before?.start.dateTime ?? before?.start.date,
      ),
    );
    setEndLocal(
      toLocalDateTimeInputValue(
        p.endIso ?? before?.end.dateTime ?? before?.end.date,
      ),
    );
    setLocation(p.location ?? before?.location ?? '');
    setDescription(p.description ?? before?.description ?? '');
    const initialAttendees =
      p.attendees ??
      (before?.attendees ?? []).map((a) => a.email).filter(Boolean);
    setAttendeesText(initialAttendees.join(', '));
    setAddGoogleMeet(Boolean(p.addGoogleMeet));
  }, [confirmation]);

  if (!confirmation) return null;

  const isDelete = confirmation.actionType === 'delete';
  const isUpdate = confirmation.actionType === 'update';

  const handleConfirmClick = () => {
    if (isDelete) {
      onConfirm();
      return;
    }

    const attendees = attendeesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    onConfirm({
      summary: summary.trim() || 'Untitled Meeting',
      startIso: startLocal ? localInputToOffsetIso(startLocal) : confirmation.payload.startIso,
      endIso: endLocal ? localInputToOffsetIso(endLocal) : confirmation.payload.endIso,
      location: location.trim() || undefined,
      description: description.trim() || undefined,
      attendees: attendees.length > 0 ? attendees : undefined,
      addGoogleMeet,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[1px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-modal-title"
    >
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <p className="text-xs font-medium text-slate-500">
              {confirmation.source === 'voice'
                ? 'Voice Intent Confirmation · Google Calendar'
                : 'Google Calendar Confirmation'}
            </p>
            <h2
              id="confirmation-modal-title"
              className="mt-0.5 text-base font-semibold text-slate-900"
            >
              {confirmation.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            aria-label="Close confirmation dialog"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <p className="text-sm text-slate-600 leading-relaxed">
            {confirmation.descriptionText}
          </p>

          {isUpdate && confirmation.beforeEvent && (
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
              <p className="font-medium text-slate-700">Current Event on Calendar</p>
              <p className="text-slate-900 font-medium">
                {confirmation.beforeEvent.summary || '(Untitled)'}
              </p>
              <p className="font-mono tabular-nums">
                {formatIsoDateTime(
                  confirmation.beforeEvent.start.dateTime ||
                    confirmation.beforeEvent.start.date,
                )}{' '}
                to{' '}
                {formatIsoDateTime(
                  confirmation.beforeEvent.end.dateTime ||
                    confirmation.beforeEvent.end.date,
                )}
              </p>
            </div>
          )}

          {isDelete ? (
            <div className="p-4 rounded-lg bg-red-50/70 border border-red-200 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-900">
                <Trash2 className="w-4 h-4 text-red-600 shrink-0" />
                <span>{confirmation.beforeEvent?.summary || 'Selected Event'}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-red-800 font-mono tabular-nums">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {formatIsoDateTime(
                    confirmation.beforeEvent?.start.dateTime ||
                      confirmation.beforeEvent?.start.date,
                  )}{' '}
                  –{' '}
                  {formatIsoDateTime(
                    confirmation.beforeEvent?.end.dateTime ||
                      confirmation.beforeEvent?.end.date,
                  )}
                </span>
              </div>
              {confirmation.payload.reason && (
                <p className="text-xs text-red-700">
                  Reason: {confirmation.payload.reason}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3.5">
              <div>
                <label
                  htmlFor="confirm-summary"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Meeting Title
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    id="confirm-summary"
                    type="text"
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="confirm-start"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Start Time
                  </label>
                  <input
                    id="confirm-start"
                    type="datetime-local"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label
                    htmlFor="confirm-end"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    End Time
                  </label>
                  <input
                    id="confirm-end"
                    type="datetime-local"
                    value={endLocal}
                    onChange={(e) => setEndLocal(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="confirm-attendees"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Attendees (comma-separated emails)
                </label>
                <div className="relative">
                  <Users className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    id="confirm-attendees"
                    type="text"
                    value={attendeesText}
                    onChange={(e) => setAttendeesText(e.target.value)}
                    placeholder="alex@company.com, sam@company.com"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="confirm-location"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Location
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    id="confirm-location"
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Conference Room B or video link"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              {confirmation.actionType === 'create' && (
                <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={addGoogleMeet}
                    onChange={(e) => setAddGoogleMeet(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <Video className="w-4 h-4 text-slate-500" />
                  <span>Attach Google Meet video conferencing link</span>
                </label>
              )}

              <div>
                <label
                  htmlFor="confirm-description"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Agenda / Notes
                </label>
                <textarea
                  id="confirm-description"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmClick}
            disabled={isSubmitting}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 ${
              isDelete
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isSubmitting
              ? 'Syncing...'
              : isDelete
              ? 'Confirm Delete'
              : isUpdate
              ? 'Confirm & Update Event'
              : 'Confirm & Book Meeting'}
          </button>
        </div>
      </div>
    </div>
  );
};
