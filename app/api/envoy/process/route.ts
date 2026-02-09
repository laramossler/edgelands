import { NextRequest, NextResponse } from 'next/server';
import { runPipeline } from '@/lib/envoy';

/**
 * POST /api/envoy/process
 * Run the Envoy processing pipeline.
 * Called by cron on Monday mornings or manually triggered.
 *
 * GET /api/envoy/process
 * Same pipeline, triggered by Vercel cron.
 */

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      const userId = process.env.DEFAULT_USER_ID;
      if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const result = await runPipeline(userId);

    return NextResponse.json({
      status: result.status,
      outreach_drafted: result.outreach_drafted,
      coffee_chats_suggested: result.coffee_chats_suggested,
      follow_ups_queued: result.follow_ups_queued,
      error: result.error,
      completed_at: result.completed_at,
    });
  } catch (error) {
    console.error('Envoy process error:', error);
    return NextResponse.json(
      { error: 'Pipeline execution failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const result = await runPipeline(userId);

    return NextResponse.json({
      status: result.status,
      outreach_drafted: result.outreach_drafted,
      coffee_chats_suggested: result.coffee_chats_suggested,
      follow_ups_queued: result.follow_ups_queued,
    });
  } catch (error) {
    console.error('Envoy process error:', error);
    return NextResponse.json(
      { error: 'Processing failed' },
      { status: 500 }
    );
  }
}
