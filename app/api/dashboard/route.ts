import { NextRequest, NextResponse } from 'next/server';
import { getWeeklyEnergySummary, getRelationshipsNeedingContact, getNextDeadline, getCurrentWeekStart, supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    // TODO: Get actual user ID from auth session
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';

    const weekStart = getCurrentWeekStart();

    // Get weekly energy summary
    const energySummary = await getWeeklyEnergySummary(userId, weekStart);

    // Get active projects
    const { data: activeProjects } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .eq('state', 'active')
      .order('updated_at', { ascending: false })
      .limit(3);

    // Get relationships needing contact
    const relationshipsNeedingContact = await getRelationshipsNeedingContact(userId);

    // Get next deadline
    const nextDeadline = await getNextDeadline(userId);

    return NextResponse.json({
      weeklyEnergy: {
        planned: energySummary.planned,
        actual: energySummary.actual,
        logsCount: energySummary.dailyLogsCount,
      },
      activeProjects: activeProjects || [],
      relationshipsNeedingContact: relationshipsNeedingContact || [],
      nextDeadline,
    });
  } catch (error) {
    console.error('Dashboard API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}
