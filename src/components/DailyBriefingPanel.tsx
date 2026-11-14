import React from 'react';
import { RefreshCw, Mic } from 'lucide-react';
import type { DailyBriefing } from '../types/calendar';

interface DailyBriefingPanelProps {
  briefing: DailyBriefing | null;
  isLoading: boolean;
  error: string | null;
  onGenerate: () => void;
  onDiscussInVoice: (summary: string) => void;
}

export const DailyBriefingPanel: React.FC<DailyBriefingPanelProps> = ({
  briefing,
  isLoading,
  error,
  onGenerate,
  onDiscussInVoice,
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Executive Daily Briefing</h2>
          <p className="text-xs text-slate-500">
            48-hour schedule analysis, focus blocks, and conflict detection
          </p>
        </div>
        <div className="flex items-center gap-2">
          {briefing && (
            <button
              type="button"
              onClick={() =>
                onDiscussInVoice(
                  `Read my executive briefing aloud and tell me the top priorities: ${briefing.headline}`,
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Mic className="w-3.5 h-3.5 text-blue-600" />
              <span>Brief Me Aloud</span>
            </button>
          )}
          <button
            type="button"
            onClick={onGenerate}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{briefing ? 'Refresh Briefing' : 'Generate Briefing'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {isLoading && !briefing ? (
        <div className="p-6 space-y-4 animate-pulse">
          <div className="h-5 w-3/4 bg-slate-200 rounded" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-28 bg-slate-100 rounded-lg" />
            <div className="h-28 bg-slate-100 rounded-lg" />
          </div>
        </div>
      ) : !briefing ? (
        <div className="p-10 text-center">
          <p className="text-sm font-medium text-slate-900">Ready to analyze your upcoming 48 hours</p>
          <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
            Click Generate Briefing to inspect meeting density, unscheduled deep-work blocks, and
            preparation priorities.
          </p>
        </div>
      ) : (
        <div className="p-6 space-y-6">
          <div className="flex flex-wrap items-baseline justify-between gap-4 pb-5 border-b border-slate-200">
            <p className="text-base font-medium text-slate-900 leading-relaxed max-w-2xl">
              {briefing.headline}
            </p>
            <div className="text-xs text-slate-500 shrink-0">
              Schedule Load:{' '}
              <span className="font-semibold text-slate-900">{briefing.scheduleLoad}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-xs font-semibold text-slate-700 mb-3">
                Priority Meetings ({briefing.priorities.length})
              </h3>
              {briefing.priorities.length === 0 ? (
                <p className="text-xs text-slate-500">No upcoming meetings in this window.</p>
              ) : (
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {briefing.priorities.map((item, idx) => (
                    <div key={idx} className="py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">{item.title}</span>
                        <span className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
                          {item.timeLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-600">{item.prepNote}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-5">
              <div>
                <h3 className="text-xs font-semibold text-slate-700 mb-3">
                  Open Focus Windows ({briefing.focusWindows.length})
                </h3>
                {briefing.focusWindows.length === 0 ? (
                  <p className="text-xs text-slate-500">No open deep-work blocks detected.</p>
                ) : (
                  <div className="divide-y divide-slate-100 border-t border-slate-100">
                    {briefing.focusWindows.map((win, idx) => (
                      <div key={idx} className="py-2 flex items-center justify-between text-xs">
                        <span className="font-mono tabular-nums text-slate-800">
                          {win.start} – {win.end}
                        </span>
                        <span className="font-mono tabular-nums text-emerald-700 font-medium">
                          {win.durationMinutes} min open
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {briefing.conflictsOrRisks.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-amber-800 mb-2">
                    Conflicts & Buffer Risks
                  </h3>
                  <ul className="space-y-1.5 text-xs text-slate-700 list-disc pl-4">
                    {briefing.conflictsOrRisks.map((risk, idx) => (
                      <li key={idx}>{risk}</li>
                    ))}
                  </ul>
                </div>
              )}

              {briefing.recommendedActions.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-700 mb-2">
                    Recommended Next Actions
                  </h3>
                  <ul className="space-y-1.5 text-xs text-slate-600 list-disc pl-4">
                    {briefing.recommendedActions.map((act, idx) => (
                      <li key={idx}>{act}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
