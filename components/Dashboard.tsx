'use client';

import { useEffect, useState } from 'react';
import EnergyChart from './EnergyChart';
import ProjectList from './ProjectList';
import RelationshipDashboard from './RelationshipDashboard';
import VoiceUpload from './VoiceUpload';
import type { EnergyBreakdown, Project, Relationship, Decision } from '@/types';
import Link from 'next/link';

interface DashboardData {
  weeklyEnergy: {
    planned?: EnergyBreakdown;
    actual?: EnergyBreakdown;
    logsCount: number;
  };
  activeProjects: Project[];
  relationshipsNeedingContact: Relationship[];
  nextDeadline?: Decision;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [quickLogInput, setQuickLogInput] = useState('');
  const [isLogging, setIsLogging] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const response = await fetch('/api/dashboard');
      if (response.ok) {
        const dashboardData = await response.json();
        setData(dashboardData);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickLog = async () => {
    if (!quickLogInput.trim() || isLogging) return;

    setIsLogging(true);
    try {
      const response = await fetch('/api/energy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: new Date().toISOString().split('T')[0],
          narrative: quickLogInput,
        }),
      });

      if (response.ok) {
        setQuickLogInput('');
        // Refresh dashboard data
        await fetchDashboardData();
      }
    } catch (error) {
      console.error('Failed to log energy:', error);
    } finally {
      setIsLogging(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-8 space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Edgelands</h1>
        <p className="text-muted">Your life operating system</p>
      </div>

      {/* Current Week Energy */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">This Week&apos;s Energy</h2>
        {data?.weeklyEnergy ? (
          <>
            <EnergyChart
              planned={data.weeklyEnergy.planned}
              actual={data.weeklyEnergy.actual}
            />
            <p className="text-sm text-muted">
              {data.weeklyEnergy.logsCount > 0
                ? `Based on ${data.weeklyEnergy.logsCount} day${data.weeklyEnergy.logsCount > 1 ? 's' : ''} logged`
                : 'No energy logs yet this week'}
            </p>
          </>
        ) : (
          <p className="text-muted">No energy allocation set for this week</p>
        )}
      </section>

      {/* Quick Log */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Quick Energy Log</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={quickLogInput}
            onChange={(e) => setQuickLogInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleQuickLog()}
            placeholder="e.g., Today was 60% Colleagues, 40% Airbnb"
            disabled={isLogging}
            className="flex-1 bg-background border border-muted/20 rounded-lg p-3 text-foreground placeholder-muted focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleQuickLog}
            disabled={isLogging || !quickLogInput.trim()}
            className="px-6 py-3 bg-accent text-background rounded-lg font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Log
          </button>
        </div>
      </section>

      {/* Active Projects & Relationships */}
      <div className="grid md:grid-cols-2 gap-8">
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Active Projects</h2>
          {data?.activeProjects && <ProjectList projects={data.activeProjects} />}
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Relationships</h2>
          {data?.relationshipsNeedingContact && (
            <RelationshipDashboard relationships={data.relationshipsNeedingContact} />
          )}
        </section>
      </div>

      {/* Next Deadline */}
      {data?.nextDeadline && (
        <section className="border border-accent/20 rounded-lg p-6 bg-accent/5">
          <h2 className="text-xl font-semibold text-foreground mb-2">Next Deadline</h2>
          <p className="text-foreground font-medium">{data.nextDeadline.title}</p>
          <p className="text-muted text-sm mt-1">
            {data.nextDeadline.deadline &&
              new Date(data.nextDeadline.deadline).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
          </p>
        </section>
      )}

      {/* Voice Upload */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Voice Memos</h2>
        <VoiceUpload onUploadComplete={fetchDashboardData} />
      </section>

      {/* Quick Actions */}
      <section className="flex gap-4">
        <Link
          href="/chat"
          className="flex-1 py-4 px-6 bg-accent text-background rounded-lg font-medium hover:bg-accent/90 transition-colors text-center"
        >
          💬 Chat with Claude
        </Link>
      </section>
    </div>
  );
}
