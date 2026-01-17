import { supabaseAdmin } from '@/lib/supabase';
import { calculateEnergyAverage } from './energyCalculations';
import type { MonthlyPattern, DailyEnergy, Project, Decision, Relationship } from '@/types';

export async function generateMonthlyPattern(userId: string): Promise<MonthlyPattern> {
  const now = new Date();
  const fourWeeksAgo = new Date(now);
  fourWeeksAgo.setDate(now.getDate() - 28);

  // Get energy trends
  const { data: dailyLogs } = await supabaseAdmin
    .from('daily_energy')
    .select('*')
    .eq('user_id', userId)
    .gte('log_date', fourWeeksAgo.toISOString().split('T')[0])
    .order('log_date', { ascending: true });

  const energyTrends = analyzeEnergyTrends(dailyLogs || []);

  // Get project velocity
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('*')
    .eq('user_id', userId);

  const projectVelocity = analyzeProjectVelocity(projects || [], fourWeeksAgo);

  // Get relationship health
  const { data: relationships } = await supabaseAdmin
    .from('relationships')
    .select('*')
    .eq('user_id', userId);

  const relationshipHealth = analyzeRelationshipHealth(relationships || []);

  // Get decision movement
  const { data: decisions } = await supabaseAdmin
    .from('decisions')
    .select('*')
    .eq('user_id', userId);

  const decisionMovement = analyzeDecisionMovement(decisions || [], fourWeeksAgo);

  // Generate recommendations
  const recommendations = generateRecommendations(
    energyTrends,
    projectVelocity,
    relationshipHealth,
    decisionMovement
  );

  return {
    energyTrends,
    projectVelocity,
    relationshipHealth,
    decisionMovement,
    recommendations,
  };
}

function analyzeEnergyTrends(logs: DailyEnergy[]) {
  if (logs.length === 0) return [];

  const domains = ['colleagues', 'airbnb', 'forest', 'personal', 'other'] as const;
  const midpoint = Math.floor(logs.length / 2);
  const firstHalf = logs.slice(0, midpoint);
  const secondHalf = logs.slice(midpoint);

  const firstAvg = calculateEnergyAverage(firstHalf);
  const secondAvg = calculateEnergyAverage(secondHalf);

  return domains.map((domain) => {
    const key = `${domain}_pct` as keyof typeof firstAvg;
    const first = firstAvg[key];
    const second = secondAvg[key];
    const diff = second - first;

    let trend: 'increasing' | 'decreasing' | 'stable';
    if (Math.abs(diff) < 5) {
      trend = 'stable';
    } else if (diff > 0) {
      trend = 'increasing';
    } else {
      trend = 'decreasing';
    }

    return {
      domain,
      averageAllocation: Math.round((first + second) / 2),
      trend,
    };
  });
}

function analyzeProjectVelocity(projects: Project[], since: Date) {
  const stateChanges = projects.filter(
    (p) => p.state_changed_at && new Date(p.state_changed_at) >= since
  ).length;

  const completions = projects.filter(
    (p) =>
      p.state === 'compost' &&
      p.state_changed_at &&
      new Date(p.state_changed_at) >= since
  ).length;

  return {
    stateChanges,
    completions,
  };
}

function analyzeRelationshipHealth(relationships: Relationship[]) {
  const tier1 = relationships.filter((r) => r.tier === 1);
  const tier2 = relationships.filter((r) => r.tier === 2);

  const tier1Maintained = tier1.every((r) => {
    if (!r.last_contact_date) return false;
    const daysSince = Math.floor(
      (Date.now() - new Date(r.last_contact_date).getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSince <= 7;
  });

  const tier2Maintained = tier2.every((r) => {
    if (!r.last_contact_date) return false;
    const daysSince = Math.floor(
      (Date.now() - new Date(r.last_contact_date).getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSince <= 14;
  });

  const avgContactFrequency =
    relationships
      .filter((r) => r.last_contact_date)
      .reduce((acc, r) => {
        const daysSince = Math.floor(
          (Date.now() - new Date(r.last_contact_date!).getTime()) / (1000 * 60 * 60 * 24)
        );
        return acc + daysSince;
      }, 0) / relationships.filter((r) => r.last_contact_date).length || 0;

  return {
    tier1Maintained,
    tier2Maintained,
    avgContactFrequency: Math.round(avgContactFrequency),
  };
}

function analyzeDecisionMovement(decisions: Decision[], since: Date) {
  const activeDecisions = decisions.filter((d) => d.status === 'active').length;

  const decidedThisMonth = decisions.filter(
    (d) => d.status === 'decided' && d.updated_at && new Date(d.updated_at) >= since
  ).length;

  const deferredThisMonth = decisions.filter(
    (d) => d.status === 'deferred' && d.updated_at && new Date(d.updated_at) >= since
  ).length;

  return {
    activeDecisions,
    decidedThisMonth,
    deferredThisMonth,
  };
}

function generateRecommendations(
  energyTrends: any[],
  projectVelocity: any,
  relationshipHealth: any,
  decisionMovement: any
): string[] {
  const recommendations: string[] = [];

  // Energy recommendations
  const increasingDomains = energyTrends.filter((t) => t.trend === 'increasing');
  const decreasingDomains = energyTrends.filter((t) => t.trend === 'decreasing');

  if (increasingDomains.length > 0) {
    const domain = increasingDomains[0].domain;
    recommendations.push(
      `${domain.charAt(0).toUpperCase() + domain.slice(1)} energy is increasing. Consider if this aligns with your goals.`
    );
  }

  if (decreasingDomains.length > 0) {
    const domain = decreasingDomains[0].domain;
    recommendations.push(
      `${domain.charAt(0).toUpperCase() + domain.slice(1)} energy is decreasing. Is this intentional?`
    );
  }

  // Project recommendations
  if (projectVelocity.stateChanges === 0) {
    recommendations.push(
      'No project state changes this month. Consider reviewing your active projects.'
    );
  }

  if (projectVelocity.completions > 0) {
    recommendations.push(
      `Completed ${projectVelocity.completions} project${projectVelocity.completions > 1 ? 's' : ''} this month. Great momentum!`
    );
  }

  // Relationship recommendations
  if (!relationshipHealth.tier1Maintained) {
    recommendations.push(
      'Some Tier 1 relationships need attention. These are your closest connections.'
    );
  }

  if (!relationshipHealth.tier2Maintained) {
    recommendations.push('Tier 2 relationships need check-ins.');
  }

  // Decision recommendations
  if (decisionMovement.activeDecisions > 5) {
    recommendations.push(
      `${decisionMovement.activeDecisions} active decisions. Consider prioritizing or deferring some.`
    );
  }

  if (decisionMovement.decidedThisMonth === 0 && decisionMovement.activeDecisions > 0) {
    recommendations.push('No decisions made this month. Are you avoiding important choices?');
  }

  if (recommendations.length === 0) {
    recommendations.push('Everything looks balanced. Keep up the intentional living!');
  }

  return recommendations;
}
