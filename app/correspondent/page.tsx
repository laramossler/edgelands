'use client';

import { Suspense, useEffect, useState } from 'react';
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

export default function CorrespondentPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="text-muted">Loading Correspondent...</div></div>}>
      <CorrespondentContent />
    </Suspense>
  );
}

function CorrespondentContent() {
  const [queue, setQueue] = useState<QueueData | null>(null);
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [metrics, setMetrics] = useState<FeedbackMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [showMetrics, setShowMetrics] = useState(false);

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
      const response = await fetch('/api/correspondent/process', {
        method: 'POST',
      });

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
      <div className="flex items-center justify-center h-screen">
        <div className="text-muted">Loading Correspondent...</div>
      </div>
    );
  }

  const editRatePct = metrics ? Math.round((1 - metrics.edit_rate) * 100) : null;

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Correspondent</h1>
          <p className="text-muted text-sm mt-1">
            Messages to Decision — {queue?.pending || 0} pending
          </p>
        </div>
        <Link
          href="/"
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          Dashboard
        </Link>
      </div>

      {/* Status bar */}
      {statusMessage && (
        <div className="text-sm text-accent bg-accent/5 border border-accent/20 rounded px-4 py-2">
          {statusMessage}
        </div>
      )}

      {/* Connection status */}
      {config && !config.gmail_connected && (
        <div className="border border-yellow-400/20 rounded-lg p-4 bg-yellow-400/5">
          <h3 className="text-sm font-medium text-yellow-400 mb-1">Gmail not connected</h3>
          <p className="text-sm text-muted mb-3">
            Connect your Gmail account to start processing email.
          </p>
          <a
            href="/api/correspondent/oauth"
            className="inline-block px-4 py-2 bg-accent text-background rounded text-sm font-medium hover:bg-accent/90 transition-colors"
          >
            Connect Gmail
          </a>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={runPipeline}
          disabled={isProcessing}
          className="px-4 py-2 bg-accent text-background rounded text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {isProcessing ? 'Processing...' : 'Run Pipeline'}
        </button>
        <Link
          href="/people"
          className="px-4 py-2 border border-muted/20 rounded text-sm text-muted hover:text-foreground transition-colors"
        >
          People Database
        </Link>
        <button
          onClick={() => setShowMetrics(!showMetrics)}
          className="px-4 py-2 border border-muted/20 rounded text-sm text-muted hover:text-foreground transition-colors"
        >
          {showMetrics ? 'Hide' : 'Show'} Learning
        </button>
        {queue?.last_run && (
          <span className="text-xs text-muted">
            Last run: {new Date(queue.last_run.completed_at || queue.last_run.started_at).toLocaleString()}
            {queue.last_run.status === 'failed' && (
              <span className="text-red-400 ml-1">(failed)</span>
            )}
          </span>
        )}
      </div>

      {/* Learning Metrics Panel */}
      {showMetrics && metrics && (
        <section className="border border-muted/20 rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-medium text-foreground">Voice Model Learning</h2>

          {/* Key metrics */}
          <div className="grid grid-cols-4 gap-3 text-center text-sm">
            <div className="border border-muted/10 rounded p-2">
              <div className="text-foreground font-medium">{metrics.total_sent}</div>
              <div className="text-muted text-xs">Sent</div>
            </div>
            <div className="border border-muted/10 rounded p-2">
              <div className={`font-medium ${editRatePct && editRatePct >= 80 ? 'text-accent' : 'text-foreground'}`}>
                {editRatePct !== null ? `${editRatePct}%` : '--'}
              </div>
              <div className="text-muted text-xs">Send rate</div>
            </div>
            <div className="border border-muted/10 rounded p-2">
              <div className="text-foreground font-medium">
                {Math.round((1 - metrics.avg_edit_ratio) * 100)}%
              </div>
              <div className="text-muted text-xs">Accuracy</div>
            </div>
            <div className="border border-muted/10 rounded p-2">
              <div className="text-foreground font-medium">{metrics.top_refinements.length}</div>
              <div className="text-muted text-xs">Rules learned</div>
            </div>
          </div>

          {/* Send rate explanation */}
          {editRatePct !== null && metrics.total_sent > 0 && (
            <p className="text-xs text-muted">
              {editRatePct >= 80
                ? 'Correspondent is writing in your voice well. Edits are rare.'
                : editRatePct >= 50
                ? 'Learning your voice. Each edit teaches the system something new.'
                : 'Still early days. Keep editing drafts — the system learns from every change.'}
              {' '}Target: 80%+ send-without-edit rate.
            </p>
          )}

          {/* Per-circle breakdown */}
          {Object.keys(metrics.by_circle).length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted font-medium">By circle:</div>
              {Object.entries(metrics.by_circle).map(([circle, data]) => (
                <div key={circle} className="flex items-center justify-between text-xs">
                  <span className="text-muted">{circle}</span>
                  <span className="text-foreground">
                    {Math.round((1 - data.edit_rate) * 100)}% accuracy ({data.sent} sent)
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Learned style rules */}
          {metrics.top_refinements.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted font-medium">Learned style rules:</div>
              {metrics.top_refinements.slice(0, 5).map((ref, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-accent mt-0.5">
                    {'*'.repeat(Math.ceil(ref.confidence * 3))}
                  </span>
                  <span className="text-foreground">{ref.refinement}</span>
                  {ref.circle && (
                    <span className="text-muted">({ref.circle})</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {metrics.total_sent === 0 && (
            <p className="text-xs text-muted">
              No messages sent yet. The system will start learning from your first edit.
            </p>
          )}
        </section>
      )}

      {/* Decision Queue */}
      <section>
        <CorrespondentQueue
          items={queue?.items || []}
          onAction={handleAction}
        />
      </section>

      {/* Pipeline Stats */}
      {queue?.last_run && queue.last_run.status === 'completed' && (
        <div className="grid grid-cols-3 gap-4 text-center text-sm">
          <div className="border border-muted/20 rounded p-3">
            <div className="text-foreground font-medium">{queue.last_run.messages_ingested}</div>
            <div className="text-muted">Ingested</div>
          </div>
          <div className="border border-muted/20 rounded p-3">
            <div className="text-foreground font-medium">{queue.last_run.messages_processed}</div>
            <div className="text-muted">Processed</div>
          </div>
          <div className="border border-muted/20 rounded p-3">
            <div className="text-foreground font-medium">{queue.last_run.drafts_generated}</div>
            <div className="text-muted">Drafted</div>
          </div>
        </div>
      )}
    </div>
  );
}
