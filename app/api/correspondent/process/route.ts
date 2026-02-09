import { NextRequest, NextResponse } from 'next/server';
import { runPipeline, checkEmergencyAlerts } from '@/lib/correspondent';

export const dynamic = 'force-dynamic';

/**
 * POST /api/correspondent/process
 * Run the full Correspondent processing pipeline.
 * Called by cron at 3:00 AM or manually triggered.
 *
 * GET /api/correspondent/process?task=emergency_check
 * Check for emergency alerts (can be called more frequently).
 */

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret or auth
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // Also check for user auth in non-cron contexts
      const userId = process.env.DEFAULT_USER_ID;
      if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';

    const result = await runPipeline(userId);

    return NextResponse.json({
      status: result.status,
      messages_ingested: result.messages_ingested,
      messages_processed: result.messages_processed,
      drafts_generated: result.drafts_generated,
      error: result.error,
      completed_at: result.completed_at,
    });
  } catch (error) {
    console.error('Correspondent process error:', error);
    return NextResponse.json(
      { error: 'Pipeline execution failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const task = searchParams.get('task');

    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';

    if (task === 'emergency_check') {
      const alerts = await checkEmergencyAlerts(userId);
      return NextResponse.json({
        alerts: alerts.length,
        messages: alerts.map(a => ({
          id: a.id,
          from: a.sender_name || a.sender_email,
          subject: a.subject,
          snippet: a.snippet,
        })),
      });
    }

    // Default: run the full pipeline
    const result = await runPipeline(userId);
    return NextResponse.json({
      status: result.status,
      messages_ingested: result.messages_ingested,
      drafts_generated: result.drafts_generated,
    });
  } catch (error) {
    console.error('Correspondent process error:', error);
    return NextResponse.json(
      { error: 'Processing failed' },
      { status: 500 }
    );
  }
}
