import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  Check,
  Clock,
  MessageSquare,
  Mic,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import type { AssistantMode, ToolActivityLog, TranscriptMessage } from '../types/calendar';

interface VoiceConsoleProps {
  assistantMode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  isVoiceConnected: boolean;
  isVoiceConnecting: boolean;
  isChatLoading: boolean;
  messages: TranscriptMessage[];
  interimUserText: string;
  toolLogs: ToolActivityLog[];
  onSendMessage: (text: string) => void;
  onQuickPrompt: (prompt: string) => void;
  onClearHistory: () => void;
}

const QUICK_PROMPTS = [
  'Brief me on my schedule today',
  'Find a 30-minute open slot tomorrow afternoon',
  'Book a 30-min Product Sync tomorrow at 2 PM with Google Meet',
];

export const VoiceConsole: React.FC<VoiceConsoleProps> = ({
  assistantMode,
  onModeChange,
  isVoiceConnected,
  isVoiceConnecting,
  isChatLoading,
  messages,
  interimUserText,
  toolLogs,
  onSendMessage,
  onQuickPrompt,
  onClearHistory,
}) => {
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, interimUserText, toolLogs, isChatLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || isChatLoading) return;
    onSendMessage(trimmed);
    setInputValue('');
  };

  return (
    <div className="flex flex-col h-full bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header with explicit Chat | Voice mode selector */}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">
              Assistant &amp; Intent Pipeline
            </h2>
            <p className="text-xs text-slate-500 truncate">
              {assistantMode === 'chat'
                ? 'Text chat with calendar scheduling tools'
                : isVoiceConnected
                ? 'Live voice session active'
                : isVoiceConnecting
                ? 'Connecting live voice...'
                : 'Voice standby'}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {(messages.length > 0 || toolLogs.length > 0) && (
              <button
                type="button"
                onClick={onClearHistory}
                title="Clear conversation"
                aria-label="Clear conversation"
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-md transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}

            <div
              role="tablist"
              aria-label="Assistant interaction mode"
              className="flex items-center gap-0.5 p-0.5 bg-slate-200/70 border border-slate-200 rounded-lg"
            >
              <button
                type="button"
                role="tab"
                aria-selected={assistantMode === 'chat'}
                onClick={() => onModeChange('chat')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  assistantMode === 'chat'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <MessageSquare className="w-3 h-3" />
                <span>Chat</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={assistantMode === 'voice'}
                onClick={() => onModeChange('voice')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  assistantMode === 'voice'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Mic className="w-3 h-3" />
                <span>Voice</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Transcript / Chat + Tool Execution Stream */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[340px] max-h-[540px]"
      >
        {messages.length === 0 && !interimUserText && toolLogs.length === 0 && !isChatLoading ? (
          <div className="py-8 text-center space-y-3">
            <p className="text-sm font-medium text-slate-800">
              {assistantMode === 'chat'
                ? 'Chat with Cadence to manage your calendar'
                : 'Speak naturally or pick a prompt to begin'}
            </p>
            <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
              {assistantMode === 'chat'
                ? 'Type any scheduling request below—no microphone required. Switch to Voice anytime for hands-free conversation.'
                : 'Click the microphone on the left to talk live, or select an example intent below.'}
            </p>
            <div className="pt-2 flex flex-col gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onQuickPrompt(prompt)}
                  className="text-left px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  “{prompt}”
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.speaker === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                  <span className="font-medium text-slate-600">
                    {msg.speaker === 'user'
                      ? 'You'
                      : msg.speaker === 'assistant'
                      ? 'Cadence'
                      : 'System'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {new Date(msg.timestamp).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div
                  className={`max-w-[90%] px-3.5 py-2.5 rounded-lg text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.speaker === 'user'
                      ? 'bg-slate-900 text-white'
                      : msg.speaker === 'system'
                      ? 'bg-amber-50 text-amber-900 border border-amber-200 text-xs'
                      : 'bg-slate-100 text-slate-900'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {interimUserText && (
              <div className="flex flex-col items-end">
                <span className="text-xs text-slate-400 mb-1">You (speaking)</span>
                <div className="max-w-[90%] px-3.5 py-2 rounded-lg text-sm bg-slate-800/80 text-slate-100 italic">
                  {interimUserText}
                </div>
              </div>
            )}

            {isChatLoading && (
              <div className="flex flex-col items-start">
                <span className="text-xs text-slate-500 mb-1 font-medium">Cadence</span>
                <div className="px-3.5 py-2.5 rounded-lg text-xs text-slate-600 bg-slate-100">
                  Checking calendar &amp; preparing response...
                </div>
              </div>
            )}

            {toolLogs.length > 0 && (
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <p className="text-xs font-medium text-slate-500">Calendar Tool Executions</p>
                {toolLogs.slice(-5).map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start justify-between gap-2.5 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      {log.status === 'completed' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : log.status === 'error' ? (
                        <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                      ) : log.status === 'cancelled' ? (
                        <XCircle className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">{log.summary}</p>
                        <p className="text-slate-400 font-mono text-[11px]">{log.name}</p>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Message Input Bar */}
      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-slate-200 bg-slate-50 flex items-center gap-2"
      >
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={isChatLoading}
          placeholder={
            assistantMode === 'chat'
              ? 'Message Cadence to manage or book meetings...'
              : isVoiceConnected
              ? 'Send a typed message to the active voice call...'
              : 'Type a message (or switch to Chat)...'
          }
          aria-label="Message Cadence"
          className="flex-1 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100"
        />
        <button
          type="submit"
          disabled={!inputValue.trim() || isChatLoading}
          aria-label="Send message"
          className="p-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
