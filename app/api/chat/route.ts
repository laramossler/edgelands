import { NextRequest, NextResponse } from 'next/server';
import { chatWithClaude } from '@/lib/claude';
import { supabaseAdmin, db, getContextSnapshot } from '@/lib/supabase';
import type { ChatRequest, Action, Message } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { message, conversationId } = body;

    // TODO: Get actual user ID from auth session
    // For now, using a placeholder - you'll need to implement auth
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';

    // Get existing conversation or create new one
    let conversationHistory: Message[] = [];
    let contextSnapshot;

    if (conversationId) {
      const { data: conversation } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (conversation) {
        conversationHistory = conversation.messages || [];
        contextSnapshot = conversation.context_snapshot;
      }
    }

    // Chat with Claude
    const { reply, actions } = await chatWithClaude(userId, message, conversationHistory);

    // Execute actions
    if (actions && actions.length > 0) {
      await executeActions(userId, actions);
    }

    // Update conversation history
    const newMessage: Message = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };

    const assistantMessage: Message = {
      role: 'assistant',
      content: reply,
      timestamp: new Date().toISOString(),
    };

    const updatedMessages = [...conversationHistory, newMessage, assistantMessage];

    // Get fresh context snapshot
    const freshContext = await getContextSnapshot(userId);

    // Save or update conversation
    let finalConversationId = conversationId;

    if (conversationId) {
      await db.updateConversation(conversationId, updatedMessages, freshContext);
    } else {
      const { data } = await db.saveConversation(userId, {
        messages: updatedMessages,
        context_snapshot: freshContext,
      });

      if (data && data.length > 0) {
        finalConversationId = data[0].id;
      }
    }

    return NextResponse.json({
      reply,
      conversationId: finalConversationId,
      actions,
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Failed to process message' },
      { status: 500 }
    );
  }
}

async function executeActions(userId: string, actions: Action[]) {
  for (const action of actions) {
    try {
      switch (action.type) {
        case 'log_energy':
          await db.logDailyEnergy(userId, action.data);
          break;

        case 'update_project':
          await db.updateProjectState(action.data.project_id, action.data.state);
          break;

        case 'create_project':
          await db.createProject(userId, action.data);
          break;

        case 'log_insight':
          await db.createIntegration(userId, {
            source: 'conversation',
            content: action.data.content,
            tags: action.data.tags,
          });
          break;

        case 'update_relationship':
          await db.updateRelationshipContact(
            action.data.relationship_id,
            action.data.last_contact_date
          );
          break;

        case 'set_non_negotiable':
          await db.createNonNegotiable(userId, action.data);
          break;

        case 'create_decision':
          await db.createDecision(userId, action.data);
          break;

        default:
          console.warn('Unknown action type:', action.type);
      }
    } catch (error) {
      console.error(`Failed to execute action ${action.type}:`, error);
    }
  }
}
