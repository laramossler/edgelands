'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import CorrespondentQueue from '@/components/CorrespondentQueue';
import Link from 'next/link';
import type { QueueItem, CorrespondentRun } from '@/types';

interface QueueData {
  items: QueueItem[];
  total: number;
  pending: number;
  last_run?: CorrespondentRun;
}

interface ConfigData {
  gmail_connected: boolean;
  process_time: string;
  timezone: string;
  emergency_alerts_enabled: boolean;
}

interface FeedbackMetrics {
  total_drafts: number;
  total_sent: number;
  edit_rate: number;
  avg_edit_ratio: number;
  by_circle: Record<string, { sent: number; edited: number; edit_rate: number }>;
  top_refinements: { refinement: string; confidence: number; times_confirmed: number; circle?: string }[];
}

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning.';
  if (hour < 17) return 'Good afternoon.';
  return 'Good evening.';
}

export default function CorrespondentPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="font-mono text-[9px] tracking-[4px] uppercase text-accent-soft">Loading dispatch...</div>
      </div>
    }>
      <CorrespondentPageInner />
    </Suspense>
  );
}

function CorrespondentPageInner() {
  const searchParams = useSearchParams();
  const justConnected = searchParams.get('connected') === 'true';

  const [queue, setQueue] = useState<QueueData | null>(null);
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [metrics, setMetrics] = useState<FeedbackMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState(justConnected ? 'Gmail connected successfully.' : '');
  const [showMetrics, setShowMetrics] = useState(false);

  const now = new Date();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [queueRes, configRes, metricsRes] = await Promise.all([
        fetch('/api/correspondent/queue'),
        fetch('/api/correspondent/config'),
        fetch('/api/correspondent/queue?format=metrics'),
      ]);

      if (queueRes.ok) setQueue(await queueRes.json());
      if (configRes.ok) setConfig(await configRes.json());
      if (metricsRes.ok) setMetrics(await metricsRes.json());
    } catch (error) {
      console.error('Failed to fetch correspondent data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAction = async (draftId: string, action: 'send' | 'edit' | 'skip' | 'defer', editedBody?: string) => {
    try {
      const response = await fetch('/api/correspondent/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_id: draftId, action, edited_body: editedBody }),
      });

      if (response.ok) {
        const result = await response.json();
        if (action === 'send' && result.success) {
          setStatusMessage('Message sent. Voice model updated.');
        } else if (action === 'skip') {
          setStatusMessage('Skipped — will return tomorrow.');
        } else if (action === 'defer') {
          setStatusMessage('Archived.');
        }
        await fetchData();
        setTimeout(() => setStatusMessage(''), 3000);
      }
    } catch (error) {
      console.error('Action failed:', error);
      setStatusMessage('Action failed. Try again.');
    }
  };

  const runPipeline = async () => {
    setIsProcessing(true);
    setStatusMessage('Running Correspondent pipeline...');
    try {
      const response = await fetch('/api/correspondent/process', { method: 'POST' });

      if (response.ok) {
        const result = await response.json();
        setStatusMessage(
          `Pipeline complete: ${result.messages_ingested} ingested, ${result.drafts_generated} drafted.`
        );
        await fetchData();
      } else {
        setStatusMessage('Pipeline failed. Check logs.');
      }
    } catch (error) {
      console.error('Pipeline error:', error);
      setStatusMessage('Pipeline error.');
    } finally {
      setIsProcessing(false);
      setTimeout(() => setStatusMessage(''), 5000);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="font-mono text-[9px] tracking-[4px] uppercase text-accent-soft">Loading dispatch...</div>
      </div>
    );
  }

  const gmailConnected = config?.gmail_connected || justConnected;
  const editRatePct = metrics ? Math.round((1 - metrics.edit_rate) * 100) : null;

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-[640px] mx-auto px-7 py-20">

        {/* Header */}
        <header className="text-center pb-9 mb-10 relative">
          <div className="font-mono text-[9px] font-normal tracking-[5px] uppercase text-accent-soft mb-5">
            Morning Dispatch
          </div>
          <h1 className="font-serif text-4xl font-light text-ink tracking-tight mb-1.5">
            {formatDate(now)}
          </h1>
          <div className="font-serif text-[15px] font-normal tracking-wide text-muted">
            {formatTime(now)}
          </div>
          <p className="font-serif text-[19px] font-light italic text-accent mt-6 leading-relaxed max-w-[480px] mx-auto">
            {getGreeting()} {queue?.pending ? `You have ${queue.pending} message${queue.pending !== 1 ? 's' : ''} waiting.` : 'Your correspondence is settled.'}
          </p>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-border" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 px-4 bg-paper text-[8px] tracking-[6px] text-border">
            &#9670;
          </div>
        </header>

        {/* Status message */}
        {statusMessage && (
          <div className="bg-sage-bg border-l-[3px] border-sage px-5 py-4 mb-8">
            <div className="text-[13.5px] leading-relaxed text-ink">{statusMessage}</div>
          </div>
        )}

        {/* Gmail connection */}
        {!gmailConnected && (
          <div className="bg-amber-bg border-l-[3px] border-amber px-5 py-4 mb-8">
            <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase text-amber mb-1.5">
              Setup Required
            </div>
            <p className="text-[13.5px] leading-relaxed text-ink mb-3">
              Connect your Gmail account to start processing your correspondence.
            </p>
            <a
              href="/api/correspondent/oauth"
              className="inline-block px-4 py-1.5 bg-sage text-white text-[11px] font-medium"
            >
              Connect Gmail
            </a>
          </div>
        )}

        {/* Connected status + controls */}
        {gmailConnected && (
          <div className="flex items-center gap-3 mb-8">
            <button
              onClick={runPipeline}
              disabled={isProcessing}
              className="px-4 py-1.5 bg-sage text-white text-[11px] font-medium disabled:opacity-50 transition-opacity"
            >
              {isProcessing ? 'Processing...' : 'Fetch New Mail'}
            </button>
            <Link
              href="/people"
              className="px-4 py-1.5 border border-border text-[11px] text-muted hover:text-ink transition-colors"
            >
              People Database
            </Link>
            <button
              onClick={() => setShowMetrics(!showMetrics)}
              className="px-4 py-1.5 border border-border text-[11px] text-muted hover:text-ink transition-colors"
            >
              {showMetrics ? 'Hide' : 'Show'} Voice Model
            </button>
            {queue?.last_run && (
              <span className="font-mono text-[10px] text-muted ml-auto">
                Last: {new Date(queue.last_run.completed_at || queue.last_run.started_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}

        {/* Voice Model Learning Panel */}
        {showMetrics && metrics && (
          <section className="bg-sky-bg border-l-[3px] border-sky px-5 py-4 mb-8">
            <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase text-sky mb-3">
              Voice Model Learning
            </div>

            <div className="grid grid-cols-4 gap-3 text-center mb-4">
              <div className="bg-card border border-border p-2.5">
                <div className="font-serif text-xl text-ink">{metrics.total_sent}</div>
                <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase text-muted mt-0.5">Sent</div>
              </div>
              <div className="bg-card border border-border p-2.5">
                <div className="font-serif text-xl text-ink">{editRatePct !== null ? `${editRatePct}%` : '--'}</div>
                <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase text-muted mt-0.5">Send Rate</div>
              </div>
              <div className="bg-card border border-border p-2.5">
                <div className="font-serif text-xl text-ink">{Math.round((1 - metrics.avg_edit_ratio) * 100)}%</div>
                <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase text-muted mt-0.5">Accuracy</div>
              </div>
              <div className="bg-card border border-border p-2.5">
                <div className="font-serif text-xl text-ink">{metrics.top_refinements.length}</div>
                <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase text-muted mt-0.5">Rules</div>
              </div>
            </div>

            {editRatePct !== null && metrics.total_sent > 0 && (
              <p className="text-[12.5px] text-muted italic leading-relaxed">
                {editRatePct >= 80
                  ? 'Correspondent is writing in your voice well. Edits are rare.'
                  : editRatePct >= 50
                  ? 'Learning your voice. Each edit teaches the system something new.'
                  : 'Still early days. Keep editing drafts — the system learns from every change.'}
              </p>
            )}

            {metrics.top_refinements.length > 0 && (
              <div className="mt-3 space-y-1">
                <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase text-sky mb-1">Learned Rules</div>
                {metrics.top_refinements.slice(0, 5).map((ref, i) => (
                  <div key={i} className="text-[12.5px] text-ink leading-relaxed">
                    {ref.refinement}
                    {ref.circle && <span className="text-muted ml-1">({ref.circle})</span>}
                  </div>
                ))}
              </div>
            )}

            {metrics.total_sent === 0 && (
              <p className="text-[12.5px] text-muted italic">
                No messages sent yet. The system will start learning from your first edit.
              </p>
            )}
          </section>
        )}

        {/* Separator */}
        <div className="text-center py-5 text-[8px] tracking-[8px] text-border">
          &#9670; &#9670; &#9670;
        </div>

        {/* Messages to Decision */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="font-mono text-[9px] font-normal tracking-[4px] uppercase text-accent-soft">
              Messages to Decision
            </span>
            <span className="flex-1 h-px bg-border" />
          </div>

          <CorrespondentQueue
            items={queue?.items || []}
            onAction={handleAction}
          />
        </section>

        {/* Pipeline Stats */}
        {queue?.last_run && queue.last_run.status === 'completed' && (
          <>
            <div className="text-center py-5 text-[8px] tracking-[8px] text-border">
              &#9670; &#9670; &#9670;
            </div>
            <div className="grid grid-cols-3 gap-px bg-border border border-border overflow-hidden mb-8">
              <div className="bg-card p-3.5 text-center">
                <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase text-muted mb-1">Ingested</div>
                <div className="font-serif text-xl text-ink">{queue.last_run.messages_ingested}</div>
              </div>
              <div className="bg-card p-3.5 text-center">
                <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase text-muted mb-1">Processed</div>
                <div className="font-serif text-xl text-ink">{queue.last_run.messages_processed}</div>
              </div>
              <div className="bg-card p-3.5 text-center">
                <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase text-muted mb-1">Drafted</div>
                <div className="font-serif text-xl text-ink">{queue.last_run.drafts_generated}</div>
              </div>
            </div>
          </>
        )}

        {/* Footer */}
        <footer className="text-center pt-9 mt-5 border-t border-border">
          <div className="font-mono text-[8px] tracking-[4px] uppercase text-border">
            Edgelands · {formatTime(now)}
          </div>
          <div className="font-mono text-[10px] text-muted mt-1.5">
            Go be in the world. This will be here when you get back.
          </div>
        </footer>
      </div>
    </div>
  );
}
