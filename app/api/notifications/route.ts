import { NextRequest, NextResponse } from 'next/server';
import {
  sendOpsReviewNotification,
  sendRelationshipNudge,
  sendMonthlyReport,
} from '@/lib/notifications';
import { supabaseAdmin, getRelationshipsNeedingContact } from '@/lib/supabase';
import { generateMonthlyPattern } from '@/utils/patternDetection';
import type { NotificationRequest } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body: NotificationRequest = await request.json();
    const { type } = body;

    // TODO: Get actual user ID from auth session
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';

    // Get user notification preferences
    const { data: prefs } = await supabaseAdmin
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!prefs) {
      return NextResponse.json(
        { error: 'No notification preferences found' },
        { status: 404 }
      );
    }

    switch (type) {
      case 'ops_review':
        if (prefs.email && prefs.phone) {
          await sendOpsReviewNotification(prefs.phone, prefs.email);
        }
        break;

      case 'relationship_nudge':
        if (prefs.relationship_nudges_enabled && prefs.email && prefs.phone) {
          const relationships = await getRelationshipsNeedingContact(userId);

          for (const relationship of relationships) {
            const daysSince = relationship.last_contact_date
              ? Math.floor(
                  (Date.now() - new Date(relationship.last_contact_date).getTime()) /
                    (1000 * 60 * 60 * 24)
                )
              : 999;

            await sendRelationshipNudge(
              prefs.phone,
              prefs.email,
              relationship.name,
              relationship.tier,
              daysSince
            );
          }
        }
        break;

      default:
        return NextResponse.json(
          { error: 'Unknown notification type' },
          { status: 400 }
        );
    }

    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error('Notifications API error:', error);
    return NextResponse.json(
      { error: 'Failed to send notifications' },
      { status: 500 }
    );
  }
}

// Cron endpoint for scheduled notifications
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const task = searchParams.get('task');

    // TODO: Get actual user ID
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';

    const { data: prefs } = await supabaseAdmin
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!prefs) {
      return NextResponse.json({ error: 'No preferences found' }, { status: 404 });
    }

    switch (task) {
      case 'sunday_ops_review':
        if (prefs.email && prefs.phone) {
          await sendOpsReviewNotification(prefs.phone, prefs.email);
        }
        break;

      case 'daily_relationship_check':
        if (prefs.relationship_nudges_enabled && prefs.email && prefs.phone) {
          const relationships = await getRelationshipsNeedingContact(userId);

          for (const relationship of relationships) {
            const daysSince = relationship.last_contact_date
              ? Math.floor(
                  (Date.now() - new Date(relationship.last_contact_date).getTime()) /
                    (1000 * 60 * 60 * 24)
                )
              : 999;

            await sendRelationshipNudge(
              prefs.phone,
              prefs.email,
              relationship.name,
              relationship.tier,
              daysSince
            );
          }
        }
        break;

      case 'monthly_pattern_analysis':
        const pattern = await generateMonthlyPattern(userId);
        const report = formatPatternReport(pattern);

        if (prefs.email) {
          await sendMonthlyReport(prefs.email, report);
        }
        break;

      default:
        return NextResponse.json({ error: 'Unknown task' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Cron task error:', error);
    return NextResponse.json({ error: 'Cron task failed' }, { status: 500 });
  }
}

function formatPatternReport(pattern: any): string {
  let report = 'EDGELANDS MONTHLY PATTERN ANALYSIS\n\n';

  report += 'ENERGY TRENDS:\n';
  pattern.energyTrends.forEach((trend: any) => {
    report += `  ${trend.domain}: ${trend.averageAllocation}% (${trend.trend})\n`;
  });

  report += '\nPROJECT VELOCITY:\n';
  report += `  State changes: ${pattern.projectVelocity.stateChanges}\n`;
  report += `  Completions: ${pattern.projectVelocity.completions}\n`;

  report += '\nRELATIONSHIP HEALTH:\n';
  report += `  Tier 1 maintained: ${pattern.relationshipHealth.tier1Maintained ? 'Yes' : 'No'}\n`;
  report += `  Tier 2 maintained: ${pattern.relationshipHealth.tier2Maintained ? 'Yes' : 'No'}\n`;
  report += `  Avg contact frequency: ${pattern.relationshipHealth.avgContactFrequency} days\n`;

  report += '\nDECISION MOVEMENT:\n';
  report += `  Active decisions: ${pattern.decisionMovement.activeDecisions}\n`;
  report += `  Decided this month: ${pattern.decisionMovement.decidedThisMonth}\n`;
  report += `  Deferred this month: ${pattern.decisionMovement.deferredThisMonth}\n`;

  report += '\nRECOMMENDATIONS:\n';
  pattern.recommendations.forEach((rec: string) => {
    report += `  - ${rec}\n`;
  });

  return report;
}
