'use client';

import { useState } from 'react';
import type { QueueItem, DraftStatus } from '@/types';

interface CorrespondentQueueProps {
  items: QueueItem[];
  onAction: (draftId: string, action: 'send' | 'edit' | 'skip' | 'defer', editedBody?: string) => Promise<void>;
}

export default function CorrespondentQueue({ items, onAction }: CorrespondentQueueProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="text-muted text-sm py-8 text-center">
        No messages waiting. Your correspondence is settled.
      </div>
    );
  }

  const handleAction = async (draftId: string, action: 'send' | 'edit' | 'skip' | 'defer', editedBody?: string) => {
    setLoadingId(draftId);
    try {
      await onAction(draftId, action, editedBody);
      if (action === 'edit') {
        setEditingId(null);
        setEditText('');
      }
    } finally {
      setLoadingId(null);
    }
  };

  const startEditing = (item: QueueItem) => {
    setEditingId(item.draft.id);
    setEditText(item.draft.edited_body || item.draft.body);
  };

  const getUrgencyColor = (urgency: number) => {
    if (urgency >= 7) return 'text-red-400';
    if (urgency >= 4) return 'text-yellow-400';
    return 'text-muted';
  };

  const getCircleColor = (circle?: string) => {
    switch (circle) {
      case 'family': return 'text-accent';
      case 'friend': return 'text-blue-400';
      case 'neighbor': return 'text-green-400';
      case 'professional': return 'text-purple-400';
      case 'community': return 'text-orange-400';
      default: return 'text-muted';
    }
  };

  const getTierLabel = (tier: string) => {
    switch (tier) {
      case 'full_draft': return 'Full';
      case 'quick_reply': return 'Quick';
      case 'batched_reply': return 'Batch';
      default: return tier;
    }
  };

  return (
    <div className="space-y-4">
      {items.map((item, index) => {
        const { draft, message, person } = item;
        const isEditing = editingId === draft.id;
        const isLoading = loadingId === draft.id;

        const fromLabel = person
          ? (person.nickname || person.name)
          : (message.sender_name || message.sender_email || 'Unknown');

        return (
          <div
            key={draft.id}
            className="border border-muted/20 rounded-lg p-5 space-y-3"
          >
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{fromLabel}</span>
                  {person && (
                    <span className={`text-xs ${getCircleColor(person.circle)}`}>
                      {person.circle}
                    </span>
                  )}
                  {!person && (
                    <span className="text-xs text-yellow-400">unknown sender</span>
                  )}
                  {draft.urgency >= 7 && (
                    <span className="text-xs text-red-400 font-medium">URGENT</span>
                  )}
                </div>
                {message.subject && (
                  <div className="text-sm text-muted">{message.subject}</div>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="px-2 py-0.5 bg-muted/10 rounded">
                  {getTierLabel(draft.draft_tier)}
                </span>
                <span className={getUrgencyColor(draft.urgency)}>
                  U{draft.urgency}
                </span>
                <span>I{draft.importance}</span>
              </div>
            </div>

            {/* Context summary */}
            <div className="text-sm text-muted">
              {item.context_summary}
              {draft.skip_count > 0 && (
                <span className="text-yellow-400 ml-2">
                  — waiting {draft.skip_count + 1} days
                </span>
              )}
            </div>

            {/* Original message snippet */}
            <div className="text-sm bg-muted/5 rounded p-3 border border-muted/10">
              <div className="text-xs text-muted mb-1">Original message:</div>
              <div className="text-foreground/80">
                {message.snippet || message.body.substring(0, 200)}
              </div>
            </div>

            {/* Draft body */}
            {isEditing ? (
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full bg-background border border-accent/30 rounded p-3 text-foreground text-sm min-h-[120px] focus:outline-none focus:border-accent"
                autoFocus
              />
            ) : (
              <div className="text-sm text-foreground bg-accent/5 rounded p-3 border border-accent/10 whitespace-pre-wrap">
                <div className="text-xs text-accent mb-1">Draft reply:</div>
                {draft.edited_body || draft.body}
              </div>
            )}

            {/* Voice notes */}
            {draft.voice_notes && (
              <div className="text-xs text-muted italic">
                {draft.voice_notes}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              {isEditing ? (
                <>
                  <button
                    onClick={() => handleAction(draft.id, 'send', editText)}
                    disabled={isLoading}
                    className="px-4 py-2 bg-accent text-background rounded text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                  >
                    {isLoading ? 'Sending...' : 'Send Edited'}
                  </button>
                  <button
                    onClick={() => { setEditingId(null); setEditText(''); }}
                    className="px-4 py-2 border border-muted/20 rounded text-sm text-muted hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleAction(draft.id, 'send')}
                    disabled={isLoading}
                    className="px-4 py-2 bg-accent text-background rounded text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                  >
                    {isLoading ? 'Sending...' : 'Send'}
                  </button>
                  <button
                    onClick={() => startEditing(item)}
                    className="px-4 py-2 border border-muted/20 rounded text-sm text-muted hover:text-foreground transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleAction(draft.id, 'skip')}
                    disabled={isLoading}
                    className="px-4 py-2 border border-muted/20 rounded text-sm text-muted hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    Skip
                  </button>
                  {draft.skip_count >= 2 && (
                    <button
                      onClick={() => handleAction(draft.id, 'defer')}
                      disabled={isLoading}
                      className="px-4 py-2 border border-red-400/20 rounded text-sm text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                    >
                      Archive
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
