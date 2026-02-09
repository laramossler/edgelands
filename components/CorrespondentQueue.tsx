'use client';

import { useState } from 'react';
import type { QueueItem } from '@/types';

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
      <div className="text-muted text-[13.5px] py-12 text-center italic">
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

  const getCircleLabel = (circle?: string) => {
    if (!circle) return null;
    return circle.charAt(0).toUpperCase() + circle.slice(1);
  };

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const { draft, message, person } = item;
        const isEditing = editingId === draft.id;
        const isLoading = loadingId === draft.id;

        const fromLabel = person
          ? (person.nickname || person.name)
          : (message.sender_name || message.sender_email || 'Unknown');

        return (
          <div
            key={draft.id}
            className="bg-card border border-border p-4 space-y-2.5"
          >
            {/* From + context */}
            <div>
              <div className="text-[13.5px] font-medium text-ink">
                {fromLabel}
                {person?.circle && (
                  <span className="text-[11.5px] font-normal text-muted ml-2">
                    {getCircleLabel(person.circle)}
                  </span>
                )}
                {!person && (
                  <span className="text-[11.5px] font-normal text-amber ml-2">
                    New sender
                  </span>
                )}
                {draft.urgency >= 7 && (
                  <span className="font-mono text-[9px] tracking-[0.5px] px-2 py-0.5 bg-rose-bg text-rose ml-2">
                    URGENT
                  </span>
                )}
              </div>
              <div className="text-[11.5px] text-muted">
                {item.context_summary}
                {draft.skip_count > 0 && (
                  <span className="text-amber ml-1">
                    — waiting {draft.skip_count + 1} days
                  </span>
                )}
              </div>
            </div>

            {/* Draft reply */}
            {isEditing ? (
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full bg-parchment border border-border p-3 text-ink text-[13px] leading-relaxed min-h-[120px] focus:outline-none focus:border-accent-soft"
                autoFocus
              />
            ) : (
              <div className="bg-parchment p-3">
                <div className="font-mono text-[8.5px] tracking-[1.5px] text-accent-soft mb-1.5">
                  DRAFT REPLY
                </div>
                <div className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap">
                  {draft.edited_body || draft.body}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-0.5">
              {isEditing ? (
                <>
                  <button
                    onClick={() => handleAction(draft.id, 'send', editText)}
                    disabled={isLoading}
                    className="px-3.5 py-1 bg-sage text-white text-[11px] font-medium disabled:opacity-50"
                  >
                    {isLoading ? 'Sending...' : 'Send Edited'}
                  </button>
                  <button
                    onClick={() => { setEditingId(null); setEditText(''); }}
                    className="px-3.5 py-1 border border-border text-[11px] text-muted hover:text-ink"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleAction(draft.id, 'send')}
                    disabled={isLoading}
                    className="px-3.5 py-1 bg-sage text-white text-[11px] font-medium disabled:opacity-50"
                  >
                    {isLoading ? 'Sending...' : 'Send'}
                  </button>
                  <button
                    onClick={() => startEditing(item)}
                    className="px-3.5 py-1 border border-border text-[11px] text-muted hover:text-ink"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleAction(draft.id, 'skip')}
                    disabled={isLoading}
                    className="text-[11px] text-muted hover:text-ink px-2 disabled:opacity-50"
                  >
                    Skip
                  </button>
                  {draft.skip_count >= 2 && (
                    <button
                      onClick={() => handleAction(draft.id, 'defer')}
                      disabled={isLoading}
                      className="text-[11px] text-rose hover:text-rose/80 px-2 disabled:opacity-50"
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
