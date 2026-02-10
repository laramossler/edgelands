import { NextRequest, NextResponse } from 'next/server';
import { discoverCandidates } from '@/lib/envoy';

export const dynamic = 'force-dynamic';

/**
 * POST /api/envoy/discover
 * Run candidate discovery manually — scans People DB and Correspondent
 * inbound messages for new outreach candidates.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const discovered = await discoverCandidates(userId);

    return NextResponse.json({
      success: true,
      candidates_discovered: discovered,
    });
  } catch (error) {
    console.error('Discovery error:', error);
    return NextResponse.json(
      { error: 'Discovery failed' },
      { status: 500 }
    );
  }
}
