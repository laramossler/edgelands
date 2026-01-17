'use client';

import type { EnergyBreakdown } from '@/types';

interface EnergyChartProps {
  planned?: EnergyBreakdown;
  actual?: EnergyBreakdown;
  showLabels?: boolean;
}

export default function EnergyChart({ planned, actual, showLabels = true }: EnergyChartProps) {
  const domains = [
    { key: 'colleagues_pct', label: 'Colleagues', color: '#3b82f6' },
    { key: 'airbnb_pct', label: 'Airbnb', color: '#ef4444' },
    { key: 'forest_pct', label: 'Forest', color: '#2d5016' },
    { key: 'personal_pct', label: 'Personal', color: '#8b5cf6' },
    { key: 'other_pct', label: 'Other', color: '#525252' },
  ] as const;

  return (
    <div className="space-y-4">
      {showLabels && (
        <div className="flex justify-between text-sm text-muted">
          <span>Planned</span>
          <span>Actual</span>
        </div>
      )}

      <div className="space-y-3">
        {domains.map(({ key, label, color }) => {
          const plannedPct = planned?.[key] || 0;
          const actualPct = actual?.[key] || 0;

          if (plannedPct === 0 && actualPct === 0) return null;

          return (
            <div key={key} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-foreground">{label}</span>
                <span className="text-muted">
                  {plannedPct > 0 && `${plannedPct}%`}
                  {plannedPct > 0 && actualPct > 0 && ' / '}
                  {actualPct > 0 && `${actualPct}%`}
                </span>
              </div>

              <div className="flex gap-2">
                {/* Planned bar */}
                <div className="flex-1 h-8 bg-background/20 rounded overflow-hidden">
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${plannedPct}%`,
                      backgroundColor: color,
                      opacity: 0.6,
                    }}
                  />
                </div>

                {/* Actual bar */}
                {actual && (
                  <div className="flex-1 h-8 bg-background/20 rounded overflow-hidden">
                    <div
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${actualPct}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
