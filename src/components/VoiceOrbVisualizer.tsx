import React from 'react';
import { Mic, MicOff } from 'lucide-react';

interface VoiceOrbVisualizerProps {
  isConnected: boolean;
  isConnecting: boolean;
  isMuted: boolean;
  inputLevel: number;
  outputLevel: number;
  isAssistantSpeaking: boolean;
  interactionStatus: 'idle' | 'in_progress';
  onToggleSession: () => void;
}

export const VoiceOrbVisualizer: React.FC<VoiceOrbVisualizerProps> = ({
  isConnected,
  isConnecting,
  isMuted,
  inputLevel,
  outputLevel,
  isAssistantSpeaking,
  interactionStatus,
  onToggleSession,
}) => {
  const activeEnergy = isAssistantSpeaking ? outputLevel : inputLevel;
  const ringScale = isConnected ? 1 + Math.min(0.28, activeEnergy * 0.45) : 1;
  const outerRingScale = isConnected ? 1 + Math.min(0.45, activeEnergy * 0.72) : 1;

  const stateLabel = isConnecting
    ? 'Connecting voice pipeline'
    : !isConnected
    ? 'Voice standby'
    : isAssistantSpeaking
    ? 'Cadence speaking'
    : interactionStatus === 'in_progress'
    ? 'Thinking & syncing'
    : isMuted
    ? 'Microphone muted'
    : 'Listening';

  const barCount = 16;
  const bars = Array.from({ length: barCount }, (_, idx) => {
    const centerBias = 1 - Math.abs(idx - (barCount - 1) / 2) / (barCount / 2);
    const dynamicHeight = isConnected
      ? Math.max(4, Math.round((activeEnergy * 28 + 3) * (0.45 + centerBias * 0.55)))
      : 4;
    return dynamicHeight;
  });

  return (
    <div className="flex flex-col items-center py-5 px-4 border-b border-slate-200 bg-white">
      <div className="relative flex items-center justify-center w-32 h-32">
        <div
          className={`absolute inset-2 rounded-full border transition-transform duration-100 ${
            isConnected
              ? isAssistantSpeaking
                ? 'border-blue-300 bg-blue-50/40'
                : 'border-slate-300 bg-slate-100/60'
              : 'border-slate-200 bg-slate-50'
          }`}
          style={{ transform: `scale(${outerRingScale})` }}
          aria-hidden="true"
        />
        <div
          className={`absolute inset-5 rounded-full border transition-transform duration-100 ${
            isConnected
              ? isAssistantSpeaking
                ? 'border-blue-400 bg-blue-100/50'
                : 'border-slate-400/70 bg-white'
              : 'border-slate-200 bg-white'
          }`}
          style={{ transform: `scale(${ringScale})` }}
          aria-hidden="true"
        />

        <button
          type="button"
          onClick={onToggleSession}
          disabled={isConnecting}
          aria-label={isConnected ? 'End voice session' : 'Start voice session'}
          className={`relative z-10 flex items-center justify-center w-16 h-16 rounded-full transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 cursor-pointer ${
            isConnected
              ? isMuted
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-slate-900 hover:bg-slate-800 text-white'
          } disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          {isConnected && isMuted ? (
            <MicOff className="w-6 h-6" strokeWidth={1.8} />
          ) : (
            <Mic className="w-6 h-6" strokeWidth={1.8} />
          )}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-1 h-7" aria-hidden="true">
        {bars.map((height, index) => (
          <span
            key={index}
            className={`w-1 rounded-sm transition-[height] duration-75 ${
              isConnected
                ? isAssistantSpeaking
                  ? 'bg-blue-600'
                  : isMuted
                  ? 'bg-amber-400'
                  : 'bg-slate-700'
                : 'bg-slate-200'
            }`}
            style={{ height: `${height}px` }}
          />
        ))}
      </div>

      <p className="mt-2 text-sm font-medium text-slate-900">{stateLabel}</p>
      <p className="mt-0.5 text-xs text-slate-500 text-center">
        {isConnected
          ? 'Speak naturally or interrupt anytime'
          : 'Click microphone to open live voice session'}
      </p>
    </div>
  );
};
