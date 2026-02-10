'use client';

import { Suspense, useEffect, useState } from 'react';
import EnvoyOutreachQueue from '@/components/EnvoyOutreachQueue';
import CoffeeChatBrief from '@/components/CoffeeChatBrief';
import EnvoyDashboard from '@/components/EnvoyDashboard';
import Link from 'next/link';
import type {
  EnvoyOutreachQueueResponse,
  EnvoyCoffeeChatSuggestion,
  EnvoyWeeklyReport,
  EnvoyPipeline,
} from '@/types';

type TabId = 'outreach' | 'coffee_chats' | 'dashboard';

export default function EnvoyPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="text-muted">Loading Envoy...</div></div>}>
      <EnvoyContent />
    </Suspense>
  );
}

function EnvoyContent() {
  const [queue, setQueue] = useState<EnvoyOutreachQueueResponse | null>(null);
  const [coffeeChats, setCoffeeChats] = useState<EnvoyCoffeeChatSuggestion[]>([]);
  const [report, setReport] = useState<EnvoyWeeklyReport | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('outreach');
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [queueRes, chatsRes, reportRes] = await Promise.all([
        fetch('/api/envoy/outreach'),
        fetch('/api/envoy/coffee-chats'),
        fetch('/api/envoy/newsletter?format=weekly_report'),
      ]);

      if (queueRes.ok) setQueue(await queueRes.json());
      if (chatsRes.ok) {
        const data = await chatsRes.json();
        setCoffeeChats(data.suggestions || []);
      }
      if (reportRes.ok) setReport(await reportRes.json());
    } catch (error) {
      console.error('Failed to fetch envoy data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOutreachAction = async (
    outreachId: string,
    action: 'send' | 'edit' | 'skip' | 'defer',
    editedBody?: string
  ) => {
    try {
      const response = await fetch('/api/envoy/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outreach_id: outreachId, action, edited_body: editedBody }),
      });

      if (response.ok) {
        const result = await response.json();
        if (action === 'send' && result.success) {
          setStatusMessage('Outreach sent. Interaction logged.');
        } else if (action === 'skip') {
          setStatusMessage('Skipped.');
        } else if (action === 'defer') {
          setStatusMessage('Deferred — marked as not now.');
        }
        await fetchData();
        setTimeout(() => setStatusMessage(''), 3000);
      }
    } catch (error) {
      console.error('Outreach action failed:', error);
      setStatusMessage('Action failed. Try again.');
    }
  };

  const handleCoffeeChatAction = async (chatId: string, action: string, data?: any) => {
    try {
      const response = await fetch('/api/envoy/coffee-chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action, ...data }),
      });

      if (response.ok) {
        const result = await response.json();
        const labels: Record<string, string> = {
          accept: 'Accepted. Outreach pending.',
          schedule: 'Scheduled.',
          complete: 'Completed. Follow-up available.',
          cancel: 'Cancelled.',
          brief: 'Brief generated.',
          follow_up: 'Follow-up drafted and queued.',
        };
        setStatusMessage(labels[action] || 'Done.');
        await fetchData();
        setTimeout(() => setStatusMessage(''), 3000);
      }
    } catch (error) {
      console.error('Coffee chat action failed:', error);
      setStatusMessage('Action failed. Try again.');
    }
  };

  const runPipeline = async () => {
    setIsProcessing(true);
    setStatusMessage('Running Envoy pipeline...');
    try {
      const response = await fetch('/api/envoy/process', { method: 'POST' });

      if (response.ok) {
        const result = await response.json();
        setStatusMessage(
          `Pipeline complete: ${result.candidates_identified || 0} discovered, ${result.outreach_drafted} drafted, ${result.coffee_chats_suggested} chats suggested, ${result.follow_ups_queued} follow-ups.`
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

  const scanForCandidates = async () => {
    setIsScanning(true);
    setStatusMessage('Scanning for candidates...');
    try {
      const response = await fetch('/api/envoy/discover', { method: 'POST' });

      if (response.ok) {
        const result = await response.json();
        setStatusMessage(
          result.candidates_discovered > 0
            ? `Found ${result.candidates_discovered} new candidate${result.candidates_discovered > 1 ? 's' : ''}. Review them in Outreach.`
            : 'No new candidates found. Try adding more people first.'
        );
        await fetchData();
      } else {
        setStatusMessage('Scan failed. Check logs.');
      }
    } catch (error) {
      console.error('Scan error:', error);
      setStatusMessage('Scan error.');
    } finally {
      setIsScanning(false);
      setTimeout(() => setStatusMessage(''), 5000);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-muted">Loading Envoy...</div>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'outreach', label: 'Outreach', count: queue?.pending || 0 },
    { id: 'coffee_chats', label: 'Coffee Chats', count: coffeeChats.length },
    { id: 'dashboard', label: 'Dashboard' },
  ];

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Envoy</h1>
          <p className="text-muted text-sm mt-1">
            Strategic outreach & relationship cultivation
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/correspondent"
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            Correspondent
          </Link>
          <Link
            href="/"
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </div>

      {/* Status bar */}
      {statusMessage && (
        <div className="text-sm text-accent bg-accent/5 border border-accent/20 rounded px-4 py-2">
          {statusMessage}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={runPipeline}
          disabled={isProcessing || isScanning}
          className="px-4 py-2 bg-accent text-background rounded text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {isProcessing ? 'Processing...' : 'Run Pipeline'}
        </button>
        <button
          onClick={scanForCandidates}
          disabled={isScanning || isProcessing}
          className="px-4 py-2 border border-accent/40 text-accent rounded text-sm font-medium hover:bg-accent/10 transition-colors disabled:opacity-50"
        >
          {isScanning ? 'Scanning...' : 'Scan for Candidates'}
        </button>
        <Link
          href="/people"
          className="px-4 py-2 border border-muted/20 rounded text-sm text-muted hover:text-foreground transition-colors"
        >
          People Database
        </Link>
        {queue?.last_run && (
          <span className="text-xs text-muted">
            Last run: {new Date(queue.last_run.completed_at || queue.last_run.started_at).toLocaleString()}
            {queue.last_run.status === 'failed' && (
              <span className="text-red-400 ml-1">(failed)</span>
            )}
          </span>
        )}
      </div>

      {/* Pipeline summary */}
      {queue && queue.pending > 0 && (
        <div className="flex gap-3 text-xs">
          {(Object.entries(queue.by_pipeline) as [EnvoyPipeline, number][])
            .filter(([, count]) => count > 0)
            .map(([pipeline, count]) => {
              const colors: Record<string, string> = {
                design_partner: 'text-purple-400',
                builder: 'text-blue-400',
                creative: 'text-orange-400',
                generous: 'text-green-400',
              };
              const labels: Record<string, string> = {
                design_partner: 'Design Partner',
                builder: 'Builder',
                creative: 'Creative',
                generous: 'Generous',
              };
              return (
                <span key={pipeline} className={colors[pipeline] || 'text-muted'}>
                  {count} {labels[pipeline] || pipeline}
                </span>
              );
            })}
        </div>
      )}

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-muted/20">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'text-accent border-accent'
                : 'text-muted border-transparent hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1.5 text-xs opacity-70">({tab.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'outreach' && (
        <section>
          <EnvoyOutreachQueue
            items={queue?.items || []}
            onAction={handleOutreachAction}
          />
        </section>
      )}

      {activeTab === 'coffee_chats' && (
        <section>
          <CoffeeChatBrief
            suggestions={coffeeChats}
            onAction={handleCoffeeChatAction}
          />
        </section>
      )}

      {activeTab === 'dashboard' && report && (
        <section>
          <EnvoyDashboard report={report} />
        </section>
      )}

      {activeTab === 'dashboard' && !report && (
        <div className="text-muted text-sm py-8 text-center">
          Run the pipeline to generate your weekly report.
        </div>
      )}
    </div>
  );
}
