import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/correspondent/config
 * Get current correspondent configuration (without sensitive tokens).
 *
 * PATCH /api/correspondent/config
 * Update correspondent configuration.
 */

export async function GET() {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';

    const { data, error } = await supabaseAdmin
      .from('correspondent_config')
      .select('user_id, gmail_connected, process_time, timezone, emergency_alerts_enabled, emergency_closeness_threshold, excluded_emails, excluded_names, created_at, updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      // Return defaults if no config exists
      return NextResponse.json({
        gmail_connected: false,
        process_time: '03:00:00',
        timezone: 'America/Los_Angeles',
        emergency_alerts_enabled: true,
        emergency_closeness_threshold: 2,
        excluded_emails: [],
        excluded_names: [],
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Config fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch config' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const body = await request.json();

    // Only allow updating safe fields
    const allowedFields = [
      'process_time',
      'timezone',
      'emergency_alerts_enabled',
      'emergency_closeness_threshold',
      'excluded_emails',
      'excluded_names',
    ];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    // Upsert
    const { data: existing } = await supabaseAdmin
      .from('correspondent_config')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from('correspondent_config')
        .update(updates)
        .eq('user_id', userId);
    } else {
      await supabaseAdmin
        .from('correspondent_config')
        .insert({ user_id: userId, ...updates });
    }

    return NextResponse.json({ success: true, updated: Object.keys(updates) });
  } catch (error) {
    console.error('Config update error:', error);
    return NextResponse.json(
      { error: 'Failed to update config' },
      { status: 500 }
    );
  }
}
