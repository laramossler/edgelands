import { NextRequest, NextResponse } from 'next/server';
import { parseEnergyNarrative } from '@/lib/claude';
import { db } from '@/lib/supabase';
import type { EnergyLogRequest } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body: EnergyLogRequest = await request.json();
    const { date, narrative } = body;

    // TODO: Get actual user ID from auth session
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';

    // Parse narrative into energy breakdown
    const parsed = await parseEnergyNarrative(narrative);

    // Log to database
    await db.logDailyEnergy(userId, {
      log_date: date,
      narrative,
      ...parsed,
    });

    return NextResponse.json({
      parsed,
      logged: true,
    });
  } catch (error) {
    console.error('Energy API error:', error);
    return NextResponse.json(
      { error: 'Failed to log energy' },
      { status: 500 }
    );
  }
}
