'use client';

import { useState } from 'react';
import type { EnvoyOutreachQueueItem } from '@/types';

interface EnvoyOutreachQueueProps {
  items: EnvoyOutreachQueueItem[];
  onAction: (outreachId: string, action: 'send' | 'edit' | 'skip' | 'defer', editedBody?: string) => Promise<void>;
}

export default function EnvoyOutreachQueue({ items, onAction }: EnvoyOutreachQueueProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="text-muted text-sm py-8 text-center">
        No outreach pending. The seeds are planted; watch them grow.
      </div>
    );
  }

  const handleAction = async (outreachId: string, action: 'send' | 'edit' | 'skip' | 'defer', editedBody?: string) => {
    setLoadingId(outreachId);
    try {
      await onAction(outreachId, action, editedBody);
      if (action === 'edit') {
        setEditingId(null);
        setEditText('');
      }
    } finally {
      setLoadingId(null);
    }
  };

  const startEditing = (item: EnvoyOutreachQueueItem) => {
    setEditingId(item.outreach.id);
    setEditText(item.outreach.edited_body || item.outreach.body);
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

  const getChannelLabel = (channel: string) => {
    switch (channel) {
      case 'email': return 'Email';
      case 'intro_request': return 'Warm Intro';
      case 'dm': return 'DM';
      case 'in_person_followup': return 'Follow-up';
      case 'handwritten': return 'Note';
      default: return channel;
    }
  };

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const { outreach, candidate } = item;
        const isEditing = editingId === outreach.id;
        const isLoading = loadingId === outreach.id;

        return (
          <div
            key={outreach.id}
            className="border border-muted/20 rounded-lg p-5 space-y-3"
          >
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{candidate.name}</span>
                  {candidate.role && (
                    <span className="text-xs text-muted">
                      {candidate.role}{candidate.organization ? `, ${candidate.organization}` : ''}
                    </span>
                  )}
                </div>
                {candidate.why_reach_out && (
                  <div className="text-sm text-muted">{candidate.why_reach_out}</div>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded ${getPipelineColor(outreach.pipeline)}`}>
                  {getPipelineLabel(outreach.pipeline)}
                </span>
                <span className="px-2 py-0.5 bg-muted/10 rounded text-muted">
                  {getChannelLabel(outreach.channel)}
                </span>
              </div>
            </div>

            {/* Newsletter invite badge */}
            {candidate.source_pool === 'newsletter_invite' && (
              <div className="text-xs text-amber-400/80 bg-amber-400/10 border border-amber-400/20 rounded px-2 py-0.5 inline-block">
                Dispatch Invite
              </div>
            )}

            {/* Warm path or shared context */}
            {candidate.warm_path && (
              <div className="text-sm text-green-400/80">
                Warm path: {candidate.warm_path}
              </div>
            )}
            {candidate.shared_interests && candidate.shared_interests.length > 0 && (
              <div className="text-xs text-muted">
                Shared: {candidate.shared_interests.join(', ')}
              </div>
            )}

            {/* Subject line for email */}
            {outreach.subject && (
              <div className="text-sm text-muted">
                <span className="text-foreground/60">Subject:</span> {outreach.subject}
              </div>
            )}

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
                {outreach.edited_body || outreach.body}
              </div>
            )}

            {/* Cultivation step */}
            {outreach.voice_notes?.startsWith('BEFORE SENDING:') && (
              <div className="text-sm text-amber-300 bg-amber-400/10 border border-amber-400/20 rounded p-3">
                <span className="font-medium">Cultivation step:</span>{' '}
                {outreach.voice_notes.split('\n\n')[0].replace('BEFORE SENDING: ', '')}
              </div>
            )}

            {/* Voice notes */}
            {outreach.voice_notes && (
              <div className="text-xs text-muted italic">
                {outreach.voice_notes.startsWith('BEFORE SENDING:')
                  ? outreach.voice_notes.split('\n\n').slice(1).join('\n\n')
                  : outreach.voice_notes}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              {isEditing ? (
                <>
                  <button
                    onClick={() => handleAction(outreach.id, 'send', editText)}
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
                    onClick={() => handleAction(outreach.id, 'send')}
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
                    onClick={() => handleAction(outreach.id, 'skip')}
                    disabled={isLoading}
                    className="px-4 py-2 border border-muted/20 rounded text-sm text-muted hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => handleAction(outreach.id, 'defer')}
                    disabled={isLoading}
                    className="px-4 py-2 border border-red-400/20 rounded text-sm text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                  >
                    Not Now
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
