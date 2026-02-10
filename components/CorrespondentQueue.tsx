'use client';

import { useState } from 'react';
import type { QueueItem } from '@/types';

interface CorrespondentQueueProps {
  items: QueueItem[];
  onAction: (draftId: string, action: 'send' | 'edit' | 'skip' | 'defer' | 'mute_sender' | 'not_important', editedBody?: string) => Promise<void>;
}

/** Try to extract clean body from potentially JSON-formatted draft body */
function extractDraftBody(body: string): string {
  if (!body) return '';
  const trimmed = body.trim();
  // If it looks like JSON, try to parse and extract the body field
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.body) return parsed.body;
    } catch {
      // Not valid JSON, use as-is
    }
  }
  // Also handle JSON wrapped in markdown code blocks
  const jsonMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (parsed.body) return parsed.body;
    } catch {
      // Not valid JSON
    }
  }
  return body;
}

export default function CorrespondentQueue({ items, onAction }: CorrespondentQueueProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [addingPersonId, setAddingPersonId] = useState<string | null>(null);
  const [personForm, setPersonForm] = useState({ name: '', circle: 'acquaintance', closeness: 3 });

  if (items.length === 0) {
    return (
      <div className="text-muted text-[13.5px] py-12 text-center italic font-serif">
        No messages waiting. Your correspondence is settled.
      </div>
    );
  }

  const handleAction = async (draftId: string, action: 'send' | 'edit' | 'skip' | 'defer' | 'mute_sender' | 'not_important', editedBody?: string) => {
    setLoadingId(draftId);
    try {
      await onAction(draftId, action, editedBody);
      if (action === 'edit') {
        setEditingId(null);
        setEditText('');
      }
    } finally {
      setLoadingId(null);
      setFeedbackId(null);
    }
  };

  const startEditing = (item: QueueItem) => {
    setEditingId(item.draft.id);
    const body = item.draft.edited_body || item.draft.body;
    setEditText(extractDraftBody(body));
  };

  const startAddPerson = (item: QueueItem) => {
    setAddingPersonId(item.draft.id);
    setPersonForm({
      name: item.message.sender_name || '',
      circle: 'acquaintance',
      closeness: 3,
    });
  };

  const submitAddPerson = async (item: QueueItem) => {
    try {
      const response = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: personForm.name,
          email: item.message.sender_email ? [item.message.sender_email] : [],
          circle: personForm.circle,
          closeness: personForm.closeness,
          relationship: 'contact',
        }),
      });
      if (response.ok) {
        setAddingPersonId(null);
      }
    } catch (err) {
      console.error('Failed to add person:', err);
    }
  };

  const getCircleLabel = (circle?: string) => {
    if (!circle) return null;
    return circle.charAt(0).toUpperCase() + circle.slice(1);
  };

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const { draft, message, person } = item;
        const isEditing = editingId === draft.id;
        const isLoading = loadingId === draft.id;
        const showFeedback = feedbackId === draft.id;
        const showAddPerson = addingPersonId === draft.id;

        const fromLabel = person
          ? (person.nickname || person.name)
          : (message.sender_name || message.sender_email || 'Unknown');

        const cleanBody = extractDraftBody(draft.edited_body || draft.body);

        return (
          <div key={draft.id} className="bg-card border border-border p-5 space-y-3">
            {/* From + context */}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-medium text-ink">{fromLabel}</span>
                {person?.circle && (
                  <span className="font-mono text-[9px] tracking-[1px] px-2 py-0.5 bg-sage-bg text-sage border border-sage/20">
                    {getCircleLabel(person.circle)}
                  </span>
                )}
                {!person && (
                  <span className="font-mono text-[9px] tracking-[1px] px-2 py-0.5 bg-amber-bg text-amber border border-amber/20">
                    New sender
                  </span>
                )}
                {draft.urgency >= 7 && (
                  <span className="font-mono text-[9px] tracking-[1px] px-2 py-0.5 bg-rose-bg text-rose border border-rose/20">
                    URGENT
                  </span>
                )}
              </div>
              <div className="text-[12px] text-muted mt-1 leading-relaxed">
                {message.subject && <span className="text-ink/60">{message.subject}</span>}
                {message.subject && item.context_summary && <span className="mx-1.5 text-border">&mdash;</span>}
                {item.context_summary}
                {draft.skip_count > 0 && (
                  <span className="text-amber ml-1">
                    — waiting {draft.skip_count + 1} days
                  </span>
                )}
              </div>
            </div>

            {/* Add to People Database form */}
            {showAddPerson && (
              <div className="bg-amber-bg/50 border border-amber/20 p-3 space-y-2">
                <div className="font-mono text-[8.5px] tracking-[1.5px] text-amber mb-2">ADD TO PEOPLE DATABASE</div>
                <div className="flex gap-2 items-center flex-wrap">
                  <input
                    value={personForm.name}
                    onChange={(e) => setPersonForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="Name"
                    className="bg-paper border border-border px-2.5 py-1 text-[12px] text-ink w-36 focus:outline-none focus:border-accent-soft"
                  />
                  <select
                    value={personForm.circle}
                    onChange={(e) => setPersonForm(p => ({ ...p, circle: e.target.value }))}
                    className="bg-paper border border-border px-2 py-1 text-[12px] text-ink focus:outline-none focus:border-accent-soft"
                  >
                    <option value="inner">Inner</option>
                    <option value="middle">Middle</option>
                    <option value="outer">Outer</option>
                    <option value="acquaintance">Acquaintance</option>
                    <option value="professional">Professional</option>
                  </select>
                  <button
                    onClick={() => submitAddPerson(item)}
                    className="px-3 py-1 bg-sage text-white text-[11px] font-medium"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setAddingPersonId(null)}
                    className="text-[11px] text-muted hover:text-ink px-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Draft reply */}
            {isEditing ? (
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full bg-parchment border border-border p-3 text-ink text-[13px] leading-relaxed min-h-[120px] focus:outline-none focus:border-accent-soft"
                autoFocus
              />
            ) : (
              <div className="bg-parchment p-3.5">
                <div className="font-mono text-[8.5px] tracking-[1.5px] text-accent-soft mb-2">
                  DRAFT REPLY
                </div>
                <div className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap">
                  {cleanBody}
                </div>
              </div>
            )}

            {/* Triage feedback panel */}
            {showFeedback && (
              <div className="bg-parchment border border-border p-3 space-y-2">
                <div className="font-mono text-[8.5px] tracking-[1.5px] text-accent-soft mb-1">TRIAGE FEEDBACK</div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => handleAction(draft.id, 'not_important')}
                    disabled={isLoading}
                    className="px-3 py-1 border border-border text-[11px] text-muted hover:text-ink hover:border-ink/30 transition-colors disabled:opacity-50"
                  >
                    Not important
                  </button>
                  <button
                    onClick={() => handleAction(draft.id, 'mute_sender')}
                    disabled={isLoading}
                    className="px-3 py-1 border border-border text-[11px] text-muted hover:text-rose hover:border-rose/30 transition-colors disabled:opacity-50"
                  >
                    Mute this sender
                  </button>
                  <button
                    onClick={() => setFeedbackId(null)}
                    className="text-[11px] text-muted hover:text-ink px-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-0.5">
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
                    className="px-3.5 py-1.5 bg-sage text-white text-[11px] font-medium disabled:opacity-50"
                  >
                    {isLoading ? 'Sending...' : 'Send'}
                  </button>
                  <button
                    onClick={() => startEditing(item)}
                    className="px-3.5 py-1.5 border border-border text-[11px] text-muted hover:text-ink transition-colors"
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

                  {/* Spacer */}
                  <span className="flex-1" />

                  {/* Feedback + Add Person buttons */}
                  <button
                    onClick={() => setFeedbackId(feedbackId === draft.id ? null : draft.id)}
                    className="text-[10px] text-muted hover:text-ink px-1.5 transition-colors"
                    title="Triage feedback"
                  >
                    &#9662;
                  </button>
                  {!person && !showAddPerson && (
                    <button
                      onClick={() => startAddPerson(item)}
                      className="text-[10px] text-amber hover:text-accent px-1.5 transition-colors"
                      title="Add to People Database"
                    >
                      + Person
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
