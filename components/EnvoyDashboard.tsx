'use client';

import type { EnvoyPipeline, EnvoyWeeklyReport } from '@/types';

interface EnvoyDashboardProps {
  report: EnvoyWeeklyReport;
}

export default function EnvoyDashboard({ report }: EnvoyDashboardProps) {
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
      case 'design_partner': return 'Design Partners';
      case 'builder': return 'Builders';
      case 'creative': return 'Creative';
      case 'generous': return 'Generous';
      default: return pipeline;
    }
  };

  const pipelines: EnvoyPipeline[] = ['design_partner', 'builder', 'creative', 'generous'];

  return (
    <div className="space-y-6">
      {/* Weekly summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="border border-muted/20 rounded-lg p-4">
          <div className="text-2xl font-medium text-foreground">{report.outreach_sent}</div>
          <div className="text-sm text-muted">Outreach Sent</div>
        </div>
        <div className="border border-muted/20 rounded-lg p-4">
          <div className="text-2xl font-medium text-foreground">{report.outreach_responded}</div>
          <div className="text-sm text-muted">Responses</div>
        </div>
        <div className="border border-muted/20 rounded-lg p-4">
          <div className="text-2xl font-medium text-foreground">{report.coffee_chats_completed}</div>
          <div className="text-sm text-muted">Coffee Chats</div>
        </div>
        <div className="border border-muted/20 rounded-lg p-4">
          <div className="text-2xl font-medium text-foreground">
            {report.newsletter_growth > 0 ? '+' : ''}{report.newsletter_growth}
          </div>
          <div className="text-sm text-muted">Newsletter Growth</div>
        </div>
      </div>

      {/* Pipeline breakdown */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">Pipeline Activity</h3>
        <div className="space-y-2">
          {pipelines.map((pipeline) => {
            const stats = report.by_pipeline[pipeline];
            return (
              <div
                key={pipeline}
                className="flex items-center justify-between border border-muted/20 rounded p-3"
              >
                <span className={`font-medium ${getPipelineColor(pipeline)}`}>
                  {getPipelineLabel(pipeline)}
                </span>
                <div className="flex gap-4 text-sm text-muted">
                  <span>{stats.outreach_sent} sent</span>
                  <span>{stats.responses} responses</span>
                  <span>{stats.active_conversations} active</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Response rate */}
      {report.outreach_sent > 0 && (
        <div className="text-sm text-muted">
          Response rate: {Math.round(report.response_rate * 100)}%
        </div>
      )}
    </div>
  );
}
