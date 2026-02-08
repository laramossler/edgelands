import { NextRequest, NextResponse } from 'next/server';
import { getQueue, generateDispatchSummary } from '@/lib/correspondent';

/**
 * GET /api/correspondent/queue
 * Returns the current decision queue for the morning dispatch.
 *
 * GET /api/correspondent/queue?format=dispatch
 * Returns a formatted text summary for the dispatch.
 */

export async function GET(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format');

    if (format === 'dispatch') {
      const summary = await generateDispatchSummary(userId);
      return NextResponse.json({ summary });
    }

    const queue = await getQueue(userId);

    return NextResponse.json(queue);
  } catch (error) {
    console.error('Queue fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch queue' },
      { status: 500 }
    );
  }
}
