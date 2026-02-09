import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import {
  recordNewsletterMetrics,
  getNewsletterMetrics,
  generateWeeklyReport,
} from '@/lib/envoy';

/**
 * GET /api/envoy/newsletter
 * Get newsletter metrics history.
 *
 * GET /api/envoy/newsletter?format=weekly_report
 * Get the full Envoy weekly report.
 *
 * POST /api/envoy/newsletter
 * Record a new newsletter metrics snapshot.
 */

export async function GET(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format');

    if (format === 'weekly_report') {
      const report = await generateWeeklyReport(userId);
      return NextResponse.json(report);
    }

    const limit = parseInt(searchParams.get('limit') || '12', 10);
    const metrics = await getNewsletterMetrics(userId, limit);

    return NextResponse.json({ metrics, total: metrics.length });
  } catch (error) {
    console.error('Envoy newsletter metrics error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch newsletter metrics' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const body = await request.json();

    if (body.subscriber_count === undefined) {
      return NextResponse.json(
        { error: 'subscriber_count is required' },
        { status: 400 }
      );
    }

    const success = await recordNewsletterMetrics(userId, {
      subscriber_count: body.subscriber_count,
      weekly_growth: body.weekly_growth || 0,
      growth_rate: body.growth_rate || 0,
      open_rate: body.open_rate,
      reply_rate: body.reply_rate,
      source_breakdown: body.source_breakdown,
      top_referrers: body.top_referrers,
    });

    return NextResponse.json({ success });
  } catch (error) {
    console.error('Envoy newsletter record error:', error);
    return NextResponse.json(
      { error: 'Failed to record newsletter metrics' },
      { status: 500 }
    );
  }
}
