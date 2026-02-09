'use client';

import { useState } from 'react';
import type { EnvoyCoffeeChatSuggestion } from '@/types';

interface CoffeeChatBriefProps {
  suggestions: EnvoyCoffeeChatSuggestion[];
  onAction: (chatId: string, action: string, data?: any) => Promise<void>;
}

export default function CoffeeChatBrief({ suggestions, onAction }: CoffeeChatBriefProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [notesId, setNotesId] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');

  if (suggestions.length === 0) {
    return (
      <div className="text-muted text-sm py-8 text-center">
        No coffee chats suggested this week. Add candidates to get started.
      </div>
    );
  }

  const handleAction = async (chatId: string, action: string, data?: any) => {
    setLoadingId(chatId);
    try {
      await onAction(chatId, action, data);
    } finally {
      setLoadingId(null);
    }
  };

  const getPipelineColor = (pipeline: string) => {
    switch (pipeline) {
      case 'design_partner': return 'text-purple-400';
      case 'builder': return 'text-blue-400';
      case 'creative': return 'text-orange-400';
      case 'generous': return 'text-green-400';
      default: return 'text-muted';
    }
  };

  const getPipelineLabel = (pipeline: string) => {
    switch (pipeline) {
      case 'design_partner': return 'Design Partner';
      case 'builder': return 'Builder';
      case 'creative': return 'Creative';
      case 'generous': return 'Generous';
      default: return pipeline;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'suggested': return 'Suggested';
      case 'outreach_pending': return 'Outreach Pending';
      case 'scheduled': return 'Scheduled';
      case 'completed': return 'Completed';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'suggested': return 'text-yellow-400';
      case 'outreach_pending': return 'text-blue-400';
      case 'scheduled': return 'text-green-400';
      case 'completed': return 'text-muted';
      default: return 'text-muted';
    }
  };

  return (
    <div className="space-y-4">
      {suggestions.map((suggestion) => {
        const { chat } = suggestion;
        const isLoading = loadingId === chat.id;
        const showNotes = notesId === chat.id;

        return (
          <div
            key={chat.id}
            className="border border-muted/20 rounded-lg p-5 space-y-3"
          >
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">
                    {chat.participant_name}
                  </span>
                  {chat.participant_role && (
                    <span className="text-xs text-muted">
                      {chat.participant_role}
                      {chat.participant_org ? `, ${chat.participant_org}` : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className={getPipelineColor(chat.pipeline)}>
                  {getPipelineLabel(chat.pipeline)}
                </span>
                <span className={`px-2 py-0.5 rounded bg-muted/10 ${getStatusColor(chat.status)}`}>
                  {getStatusLabel(chat.status)}
                </span>
              </div>
            </div>

            {/* Why now */}
            {chat.why_now && (
              <div className="text-sm text-foreground/80">
                <span className="text-muted">Why now:</span> {chat.why_now}
              </div>
            )}

            {/* Topics */}
            {chat.suggested_topics && chat.suggested_topics.length > 0 && (
              <div className="text-sm">
                <span className="text-muted">Topics:</span>
                <ul className="mt-1 space-y-0.5">
                  {chat.suggested_topics.map((topic, i) => (
                    <li key={i} className="text-foreground/80 pl-3">- {topic}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Ask */}
            {chat.your_ask && (
              <div className="text-sm text-foreground/80">
                <span className="text-muted">Your ask:</span> {chat.your_ask}
              </div>
            )}

            {/* Brief (for scheduled chats) */}
            {chat.brief && (
              <div className="text-sm bg-accent/5 rounded p-3 border border-accent/10 whitespace-pre-wrap">
                <div className="text-xs text-accent mb-1">Chat Brief:</div>
                {chat.brief}
              </div>
            )}

            {/* Notes input for completing */}
            {showNotes && (
              <div className="space-y-2">
                <textarea
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  placeholder="How did it go? Any follow-up items?"
                  className="w-full bg-background border border-accent/30 rounded p-3 text-foreground text-sm min-h-[80px] focus:outline-none focus:border-accent"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      handleAction(chat.id, 'complete', { notes: notesText });
                      setNotesId(null);
                      setNotesText('');
                    }}
                    disabled={isLoading}
                    className="px-4 py-2 bg-accent text-background rounded text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                  >
                    {isLoading ? 'Saving...' : 'Mark Complete'}
                  </button>
                  <button
                    onClick={() => { setNotesId(null); setNotesText(''); }}
                    className="px-4 py-2 border border-muted/20 rounded text-sm text-muted hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Actions */}
            {!showNotes && (
              <div className="flex gap-2 pt-1">
                {chat.status === 'suggested' && (
                  <>
                    <button
                      onClick={() => handleAction(chat.id, 'accept')}
                      disabled={isLoading}
                      className="px-4 py-2 bg-accent text-background rounded text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                    >
                      {isLoading ? 'Accepting...' : 'Accept'}
                    </button>
                    <button
                      onClick={() => handleAction(chat.id, 'cancel')}
                      disabled={isLoading}
                      className="px-4 py-2 border border-muted/20 rounded text-sm text-muted hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      Skip
                    </button>
                  </>
                )}
                {chat.status === 'scheduled' && (
                  <>
                    <button
                      onClick={() => handleAction(chat.id, 'brief')}
                      disabled={isLoading}
                      className="px-4 py-2 border border-accent/30 rounded text-sm text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
                    >
                      {isLoading ? 'Generating...' : 'Generate Brief'}
                    </button>
                    <button
                      onClick={() => setNotesId(chat.id)}
                      className="px-4 py-2 bg-accent text-background rounded text-sm font-medium hover:bg-accent/90 transition-colors"
                    >
                      Complete
                    </button>
                    <button
                      onClick={() => handleAction(chat.id, 'cancel')}
                      disabled={isLoading}
                      className="px-4 py-2 border border-red-400/20 rounded text-sm text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </>
                )}
                {chat.status === 'completed' && !chat.follow_up_drafted && (
                  <button
                    onClick={() => handleAction(chat.id, 'follow_up', { notes: chat.follow_up_notes })}
                    disabled={isLoading}
                    className="px-4 py-2 border border-accent/30 rounded text-sm text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
                  >
                    {isLoading ? 'Drafting...' : 'Draft Follow-up'}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
