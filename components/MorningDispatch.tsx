'use client';

import { useEffect, useState } from 'react';
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
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning.';
  if (hour < 17) return 'Good afternoon.';
  return 'Good evening.';
}

function getSubGreeting(pending: number, lastRun?: CorrespondentRun, gmailConnected?: boolean) {
  if (!gmailConnected) return 'Connect your email to begin.';
  if (!lastRun) return 'Run your first dispatch to see what\'s waiting.';

  const lastRunTime = new Date(lastRun.completed_at || lastRun.started_at);
  const hoursSinceRun = (Date.now() - lastRunTime.getTime()) / (1000 * 60 * 60);

  if (pending > 0) {
    if (pending === 1) return 'One message awaits your attention.';
    if (pending <= 3) return `${pending} messages await your attention.`;
    return `${pending} messages are waiting. Take your time.`;
  }

  // No pending messages
  if (hoursSinceRun < 1) return 'Your correspondence is settled.';
  if (hoursSinceRun < 6) return 'All clear since your last check.';
  if (hoursSinceRun < 24) return 'Quiet since this morning. Fetch new mail when ready.';
  return 'It\'s been a while. Fetch new mail to see what\'s come in.';
}

interface MorningDispatchProps {
  justConnected?: boolean;
}

export default function MorningDispatch({ justConnected }: MorningDispatchProps) {
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
      console.error('Failed to fetch data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAction = async (draftId: string, action: 'send' | 'edit' | 'skip' | 'defer' | 'mute_sender' | 'not_important', editedBody?: string) => {
    try {
      const response = await fetch('/api/correspondent/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_id: draftId, action, edited_body: editedBody }),
      });
      if (response.ok) {
        if (action === 'send') setStatusMessage('Message sent. Voice model updated.');
        else if (action === 'skip') setStatusMessage('Skipped — will return tomorrow.');
        else if (action === 'defer') setStatusMessage('Archived.');
        else if (action === 'mute_sender') setStatusMessage('Sender muted. Future messages will be auto-archived.');
        else if (action === 'not_important') setStatusMessage('Marked not important. Triage adjusted.');
        await fetchData();
        setTimeout(() => setStatusMessage(''), 3000);
      }
    } catch (error) {
      console.error('Action failed:', error);
      setStatusMessage('Action failed. Try again.');
    }
  };

  const [pipelineStage, setPipelineStage] = useState('');

  const runPipeline = async () => {
    setIsProcessing(true);
    setStatusMessage('');
    setPipelineStage('Connecting to Gmail...');

    // Simulate stage progression while waiting for the API
    const stages = [
      { text: 'Connecting to Gmail...', delay: 0 },
      { text: 'Fetching new messages...', delay: 2000 },
      { text: 'Identifying senders...', delay: 5000 },
      { text: 'Triaging messages...', delay: 8000 },
      { text: 'Drafting replies in your voice...', delay: 12000 },
      { text: 'Building your dispatch...', delay: 18000 },
    ];

    const timers = stages.map(({ text, delay }) =>
      setTimeout(() => setPipelineStage(text), delay)
    );

    try {
      const response = await fetch('/api/correspondent/process', { method: 'POST' });
      timers.forEach(clearTimeout);
      setPipelineStage('');

      if (response.ok) {
        const result = await response.json();
        if (result.messages_ingested > 0) {
          setStatusMessage(`${result.messages_ingested} new message${result.messages_ingested !== 1 ? 's' : ''} found, ${result.drafts_generated} draft${result.drafts_generated !== 1 ? 's' : ''} prepared.`);
        } else {
          const debugMsg = result.debug ? ` (${result.debug})` : '';
          setStatusMessage(`No new messages found.${debugMsg}`);
        }
        await fetchData();
      } else {
        setStatusMessage('Pipeline failed. Check logs.');
      }
    } catch (error) {
      timers.forEach(clearTimeout);
      setPipelineStage('');
      setStatusMessage('Pipeline error. Please try again.');
    } finally {
      setIsProcessing(false);
      setTimeout(() => setStatusMessage(''), 8000);
    }
  };

  const gmailConnected = config?.gmail_connected || justConnected;
  const editRatePct = metrics ? Math.round((1 - metrics.edit_rate) * 100) : null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center pt-12">
        <div className="font-mono text-[9px] tracking-[4px] uppercase text-accent-soft">Loading dispatch...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-[640px] mx-auto px-7 pt-20 pb-24">

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
            {getGreeting()} {getSubGreeting(queue?.pending || 0, queue?.last_run, gmailConnected)}
          </p>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-border" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 px-4 bg-paper text-[8px] tracking-[6px] text-border">&#9670;</div>
        </header>

        {/* Pipeline loading */}
        {isProcessing && pipelineStage && (
          <div className="bg-sage-bg/60 border-l-[3px] border-sage px-5 py-4 mb-8">
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-sage animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-sage animate-pulse [animation-delay:200ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-sage animate-pulse [animation-delay:400ms]" />
              </div>
              <div className="text-[13px] text-ink italic font-serif">{pipelineStage}</div>
            </div>
          </div>
        )}

        {/* Status */}
        {statusMessage && !isProcessing && (
          <div className="bg-sage-bg border-l-[3px] border-sage px-5 py-4 mb-8">
            <div className="text-[13.5px] leading-relaxed text-ink">{statusMessage}</div>
          </div>
        )}

        {/* Gmail setup */}
        {!gmailConnected && (
          <div className="bg-amber-bg border-l-[3px] border-amber px-5 py-4 mb-8">
            <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase text-amber mb-1.5">Setup Required</div>
            <p className="text-[13.5px] leading-relaxed text-ink mb-3">Connect your Gmail account to start processing your correspondence.</p>
            <a href="/api/correspondent/oauth" className="inline-block px-4 py-1.5 bg-sage text-white text-[11px] font-medium">
              Connect Gmail
            </a>
          </div>
        )}

        {/* Controls */}
        {gmailConnected && (
          <div className="flex items-center gap-3 mb-8 flex-wrap">
            <button onClick={runPipeline} disabled={isProcessing} className="px-4 py-1.5 bg-sage text-white text-[11px] font-medium disabled:opacity-50">
              {isProcessing ? 'Processing...' : 'Fetch New Mail'}
            </button>
            <Link href="/people" className="px-4 py-1.5 border border-border text-[11px] text-muted hover:text-ink transition-colors">
              People Database
            </Link>
            <button onClick={() => setShowMetrics(!showMetrics)} className="px-4 py-1.5 border border-border text-[11px] text-muted hover:text-ink transition-colors">
              {showMetrics ? 'Hide' : 'Show'} Voice Model
            </button>
            {queue?.last_run && (
              <span className="font-mono text-[10px] text-muted ml-auto">
                Last: {new Date(queue.last_run.completed_at || queue.last_run.started_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}

        {/* Voice Model */}
        {showMetrics && metrics && (
          <section className="bg-sky-bg border-l-[3px] border-sky px-5 py-4 mb-8">
            <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase text-sky mb-3">Voice Model Learning</div>
            <div className="grid grid-cols-4 gap-3 text-center mb-4">
              {[
                { value: metrics.total_sent, label: 'Sent' },
                { value: editRatePct !== null ? `${editRatePct}%` : '--', label: 'Send Rate' },
                { value: `${Math.round((1 - metrics.avg_edit_ratio) * 100)}%`, label: 'Accuracy' },
                { value: metrics.top_refinements.length, label: 'Rules' },
              ].map((stat, i) => (
                <div key={i} className="bg-card border border-border p-2.5">
                  <div className="font-serif text-xl text-ink">{stat.value}</div>
                  <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase text-muted mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>
            {metrics.top_refinements.length > 0 && (
              <div className="space-y-1">
                {metrics.top_refinements.slice(0, 5).map((ref, i) => (
                  <div key={i} className="text-[12.5px] text-ink leading-relaxed">
                    {ref.refinement}{ref.circle && <span className="text-muted ml-1">({ref.circle})</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Separator */}
        <div className="text-center py-5 text-[8px] tracking-[8px] text-border">&#9670; &#9670; &#9670;</div>

        {/* Messages to Decision */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="font-mono text-[9px] font-normal tracking-[4px] uppercase text-accent-soft">Messages to Decision</span>
            <span className="flex-1 h-px bg-border" />
          </div>
          <CorrespondentQueue items={queue?.items || []} onAction={handleAction} />
        </section>

        {/* Footer */}
        <footer className="text-center pt-9 mt-5 border-t border-border">
          <div className="font-mono text-[8px] tracking-[4px] uppercase text-border">Dispatched at {formatTime(now)}</div>
          <div className="font-mono text-[10px] text-muted mt-1.5">Go be in the world. This will be here when you get back.</div>
        </footer>
      </div>
    </div>
  );
}
