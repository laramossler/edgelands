import { NextRequest, NextResponse } from 'next/server';
import {
  getOutreachQueue,
  approveOutreach,
  editOutreach,
  skipOutreach,
  deferOutreach,
  generateEnvoyDispatchSummary,
} from '@/lib/envoy';
import type { EnvoyOutreachActionRequest } from '@/types';

/**
 * GET /api/envoy/outreach
 * Returns the current outreach queue.
 *
 * GET /api/envoy/outreach?format=dispatch
 * Returns formatted dispatch summary.
 *
 * POST /api/envoy/outreach
 * Perform an action on an outreach draft: send, edit, skip, or defer.
 */

export async function GET(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format');

    if (format === 'dispatch') {
      const summary = await generateEnvoyDispatchSummary(userId);
      return NextResponse.json({ summary });
    }

    const queue = await getOutreachQueue(userId);
    return NextResponse.json(queue);
  } catch (error) {
    console.error('Envoy outreach queue error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch outreach queue' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const body: EnvoyOutreachActionRequest = await request.json();
    const { outreach_id, action, edited_body } = body;

    if (!outreach_id || !action) {
      return NextResponse.json(
        { error: 'outreach_id and action are required' },
        { status: 400 }
      );
    }

    let success = false;

    switch (action) {
      case 'send': {
        if (edited_body) {
          await editOutreach(userId, outreach_id, edited_body);
        }
        success = await approveOutreach(userId, outreach_id);
        break;
      }
      case 'edit': {
        if (!edited_body) {
          return NextResponse.json(
            { error: 'edited_body is required for edit action' },
            { status: 400 }
          );
        }
        success = await editOutreach(userId, outreach_id, edited_body);
        break;
      }
      case 'skip': {
        success = await skipOutreach(userId, outreach_id);
        break;
      }
      case 'defer': {
        success = await deferOutreach(userId, outreach_id);
        break;
      }
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ success, action, outreach_id });
  } catch (error) {
    console.error('Envoy outreach action error:', error);
    return NextResponse.json(
      { error: 'Failed to process action' },
      { status: 500 }
    );
  }
}
