import type { EnergyBreakdown, DailyEnergy, EnergyAllocation } from '@/types';

export function calculateEnergyAverage(logs: DailyEnergy[]): EnergyBreakdown {
  if (logs.length === 0) {
    return {
      colleagues_pct: 0,
      airbnb_pct: 0,
      forest_pct: 0,
      personal_pct: 0,
      other_pct: 0,
    };
  }

  const sum = logs.reduce(
    (acc, log) => ({
      colleagues_pct: acc.colleagues_pct + (log.colleagues_pct || 0),
      airbnb_pct: acc.airbnb_pct + (log.airbnb_pct || 0),
      forest_pct: acc.forest_pct + (log.forest_pct || 0),
      personal_pct: acc.personal_pct + (log.personal_pct || 0),
      other_pct: acc.other_pct + (log.other_pct || 0),
    }),
    {
      colleagues_pct: 0,
      airbnb_pct: 0,
      forest_pct: 0,
      personal_pct: 0,
      other_pct: 0,
    }
  );

  return {
    colleagues_pct: Math.round(sum.colleagues_pct / logs.length),
    airbnb_pct: Math.round(sum.airbnb_pct / logs.length),
    forest_pct: Math.round(sum.forest_pct / logs.length),
    personal_pct: Math.round(sum.personal_pct / logs.length),
    other_pct: Math.round(sum.other_pct / logs.length),
  };
}

export function calculateVariance(planned: EnergyBreakdown, actual: EnergyBreakdown) {
  return {
    colleagues: actual.colleagues_pct - planned.colleagues_pct,
    airbnb: actual.airbnb_pct - planned.airbnb_pct,
    forest: actual.forest_pct - planned.forest_pct,
    personal: actual.personal_pct - planned.personal_pct,
    other: actual.other_pct - planned.other_pct,
  };
}

export function getEnergyInsight(variance: ReturnType<typeof calculateVariance>): string {
  const domains = Object.entries(variance)
    .map(([domain, diff]) => ({ domain, diff }))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  if (domains.length === 0) return 'Energy allocation matched perfectly!';

  const biggest = domains[0];
  if (Math.abs(biggest.diff) < 10) {
    return 'Energy allocation was very close to plan.';
  }

  const direction = biggest.diff > 0 ? 'more' : 'less';
  const domain = biggest.domain.charAt(0).toUpperCase() + biggest.domain.slice(1);

  return `Spent ${Math.abs(biggest.diff)}% ${direction} on ${domain} than planned.`;
}

export function normalizePercentages(breakdown: Partial<EnergyBreakdown>): EnergyBreakdown {
  const total =
    (breakdown.colleagues_pct || 0) +
    (breakdown.airbnb_pct || 0) +
    (breakdown.forest_pct || 0) +
    (breakdown.personal_pct || 0) +
    (breakdown.other_pct || 0);

  if (total === 0) {
    return {
      colleagues_pct: 0,
      airbnb_pct: 0,
      forest_pct: 0,
      personal_pct: 0,
      other_pct: 0,
    };
  }

  if (total === 100) {
    return {
      colleagues_pct: breakdown.colleagues_pct || 0,
      airbnb_pct: breakdown.airbnb_pct || 0,
      forest_pct: breakdown.forest_pct || 0,
      personal_pct: breakdown.personal_pct || 0,
      other_pct: breakdown.other_pct || 0,
    };
  }

  // Normalize to 100%
  const factor = 100 / total;
  return {
    colleagues_pct: Math.round((breakdown.colleagues_pct || 0) * factor),
    airbnb_pct: Math.round((breakdown.airbnb_pct || 0) * factor),
    forest_pct: Math.round((breakdown.forest_pct || 0) * factor),
    personal_pct: Math.round((breakdown.personal_pct || 0) * factor),
    other_pct: Math.round((breakdown.other_pct || 0) * factor),
  };
}

export function getWeekDateRange(weekStart: string): { start: Date; end: Date } {
  const start = new Date(weekStart);
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);

  return { start, end };
}

export function getMonday(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

export function formatEnergyBreakdown(breakdown: EnergyBreakdown): string {
  const parts: string[] = [];

  if (breakdown.colleagues_pct > 0) parts.push(`Colleagues: ${breakdown.colleagues_pct}%`);
  if (breakdown.airbnb_pct > 0) parts.push(`Airbnb: ${breakdown.airbnb_pct}%`);
  if (breakdown.forest_pct > 0) parts.push(`Forest: ${breakdown.forest_pct}%`);
  if (breakdown.personal_pct > 0) parts.push(`Personal: ${breakdown.personal_pct}%`);
  if (breakdown.other_pct > 0) parts.push(`Other: ${breakdown.other_pct}%`);

  return parts.join(', ');
}
