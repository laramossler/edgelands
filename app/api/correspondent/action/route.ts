import { NextRequest, NextResponse } from 'next/server';
import {
  approveDraft,
  editDraft,
  skipDraft,
  deferDraft,
} from '@/lib/correspondent';
import type { DraftActionRequest } from '@/types';

/**
 * POST /api/correspondent/action
 * Perform an action on a draft: send, edit, skip, or defer.
 */

export async function POST(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const body: DraftActionRequest = await request.json();
    const { draft_id, action, edited_body } = body;

    if (!draft_id || !action) {
      return NextResponse.json(
        { error: 'draft_id and action are required' },
        { status: 400 }
      );
    }

    let success = false;

    switch (action) {
      case 'send': {
        // If there's an edited body, save the edit first
        if (edited_body) {
          await editDraft(userId, draft_id, edited_body);
        }
        success = await approveDraft(userId, draft_id);
        break;
      }

      case 'edit': {
        if (!edited_body) {
          return NextResponse.json(
            { error: 'edited_body is required for edit action' },
            { status: 400 }
          );
        }
        success = await editDraft(userId, draft_id, edited_body);
        break;
      }

      case 'skip': {
        success = await skipDraft(userId, draft_id);
        break;
      }

      case 'defer': {
        success = await deferDraft(userId, draft_id);
        break;
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ success, action, draft_id });
  } catch (error) {
    console.error('Draft action error:', error);
    return NextResponse.json(
      { error: 'Failed to process action' },
      { status: 500 }
    );
  }
}
