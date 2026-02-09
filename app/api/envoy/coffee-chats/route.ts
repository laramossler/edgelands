import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import {
  getCoffeeChatSuggestions,
  acceptCoffeeChat,
  scheduleCoffeeChat,
  completeCoffeeChat,
  cancelCoffeeChat,
  generateCoffeeChatBrief,
  generateCoffeeChatFollowUp,
} from '@/lib/envoy';

/**
 * GET /api/envoy/coffee-chats
 * Get coffee chat suggestions, optionally filtered by week.
 *
 * POST /api/envoy/coffee-chats
 * Perform an action on a coffee chat: accept, schedule, complete, cancel, brief, follow_up.
 */

export async function GET(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const { searchParams } = new URL(request.url);
    const weekStart = searchParams.get('week');

    const suggestions = await getCoffeeChatSuggestions(
      userId,
      weekStart || undefined
    );

    return NextResponse.json({
      suggestions,
      total: suggestions.length,
    });
  } catch (error) {
    console.error('Envoy coffee chats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch coffee chat suggestions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const body = await request.json();

    if (!body.chat_id || !body.action) {
      return NextResponse.json(
        { error: 'chat_id and action are required' },
        { status: 400 }
      );
    }

    const { chat_id, action } = body;
    let success = false;
    let data: any = null;

    switch (action) {
      case 'accept':
        success = await acceptCoffeeChat(userId, chat_id);
        break;

      case 'schedule':
        if (!body.scheduled_at) {
          return NextResponse.json(
            { error: 'scheduled_at is required for schedule action' },
            { status: 400 }
          );
        }
        success = await scheduleCoffeeChat(userId, chat_id, body.scheduled_at);
        break;

      case 'complete':
        success = await completeCoffeeChat(userId, chat_id, body.notes);
        break;

      case 'cancel':
        success = await cancelCoffeeChat(userId, chat_id);
        break;

      case 'brief':
        data = await generateCoffeeChatBrief(userId, chat_id);
        success = !!data;
        break;

      case 'follow_up':
        data = await generateCoffeeChatFollowUp(userId, chat_id, body.notes);
        success = !!data;
        break;

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ success, action, data });
  } catch (error) {
    console.error('Envoy coffee chat action error:', error);
    return NextResponse.json(
      { error: 'Failed to process coffee chat action' },
      { status: 500 }
    );
  }
}
