import { NextRequest, NextResponse } from 'next/server';
import {
  approveDraft,
  editDraft,
  skipDraft,
  deferDraft,
} from '@/lib/correspondent';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/correspondent/action
 * Perform an action on a draft: send, edit, skip, defer, mute_sender, or not_important.
 */

export async function POST(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const body = await request.json();
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

      case 'mute_sender': {
        // Get the sender email from the draft's message
        const { data: draft } = await supabaseAdmin
          .from('correspondent_drafts')
          .select('message_id')
          .eq('id', draft_id)
          .eq('user_id', userId)
          .maybeSingle();

        if (draft) {
          const { data: message } = await supabaseAdmin
            .from('correspondent_messages')
            .select('sender_email')
            .eq('id', draft.message_id)
            .maybeSingle();

          if (message?.sender_email) {
            // Add to excluded_emails list
            const { data: config } = await supabaseAdmin
              .from('correspondent_config')
              .select('excluded_emails')
              .eq('user_id', userId)
              .maybeSingle();

            const excluded = config?.excluded_emails || [];
            if (!excluded.includes(message.sender_email)) {
              excluded.push(message.sender_email);
              await supabaseAdmin
                .from('correspondent_config')
                .update({ excluded_emails: excluded })
                .eq('user_id', userId);
            }

            // Find all message IDs from this sender and defer their drafts
            const { data: senderMessages } = await supabaseAdmin
              .from('correspondent_messages')
              .select('id')
              .eq('sender_email', message.sender_email);

            if (senderMessages && senderMessages.length > 0) {
              const messageIds = senderMessages.map(m => m.id);
              await supabaseAdmin
                .from('correspondent_drafts')
                .update({ status: 'deferred' })
                .eq('user_id', userId)
                .eq('status', 'pending')
                .in('message_id', messageIds);
            }
          }
        }
        success = true;
        break;
      }

      case 'not_important': {
        // Defer this draft and lower the triage score for future learning
        await supabaseAdmin
          .from('correspondent_drafts')
          .update({ status: 'deferred' })
          .eq('id', draft_id)
          .eq('user_id', userId);

        // Mark the message with lowered importance for future triage learning
        const { data: draft } = await supabaseAdmin
          .from('correspondent_drafts')
          .select('message_id')
          .eq('id', draft_id)
          .maybeSingle();

        if (draft) {
          await supabaseAdmin
            .from('correspondent_messages')
            .update({ importance: 0, urgency: 0, triage_summary: 'User marked as not important' })
            .eq('id', draft.message_id);
        }

        success = true;
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
