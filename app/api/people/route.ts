import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import {
  createPerson,
  updatePerson,
  getPerson,
  deletePerson,
  getAllPeople,
  getPeopleByCircle,
  getPeopleNeedingContact,
  getUpcomingTouchpoints,
} from '@/lib/people';
import type { Circle } from '@/types';

/**
 * GET /api/people
 * List all people, optionally filtered.
 *
 * Query params:
 *   circle=family|neighbor|friend|professional|community|acquaintance
 *   view=needing_contact — people overdue for contact
 *   view=touchpoints — upcoming touchpoints
 *
 * POST /api/people
 * Create a new person record.
 *
 * PATCH /api/people?id=<uuid>
 * Update an existing person record.
 *
 * DELETE /api/people?id=<uuid>
 * Delete a person record.
 */

export async function GET(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const { searchParams } = new URL(request.url);
    const circle = searchParams.get('circle') as Circle | null;
    const view = searchParams.get('view');
    const id = searchParams.get('id');

    // Single person lookup
    if (id) {
      const person = await getPerson(id);
      if (!person) {
        return NextResponse.json({ error: 'Person not found' }, { status: 404 });
      }
      return NextResponse.json(person);
    }

    // Special views
    if (view === 'needing_contact') {
      const people = await getPeopleNeedingContact(userId);
      return NextResponse.json({ people, count: people.length });
    }

    if (view === 'touchpoints') {
      const days = parseInt(searchParams.get('days') || '14');
      const people = await getUpcomingTouchpoints(userId, days);
      return NextResponse.json({ people, count: people.length });
    }

    // Filtered by circle
    if (circle) {
      const people = await getPeopleByCircle(userId, circle);
      return NextResponse.json({ people, count: people.length });
    }

    // All people
    const people = await getAllPeople(userId);
    return NextResponse.json({ people, count: people.length });
  } catch (error) {
    console.error('People API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch people' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const body = await request.json();

    // Validate required fields
    if (!body.name || !body.circle || !body.closeness || !body.relationship) {
      return NextResponse.json(
        { error: 'name, circle, closeness, and relationship are required' },
        { status: 400 }
      );
    }

    const person = await createPerson(userId, body);

    if (!person) {
      return NextResponse.json(
        { error: 'Failed to create person' },
        { status: 500 }
      );
    }

    return NextResponse.json(person, { status: 201 });
  } catch (error) {
    console.error('Create person error:', error);
    return NextResponse.json(
      { error: 'Failed to create person' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'id query parameter is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const person = await updatePerson(id, body);

    if (!person) {
      return NextResponse.json(
        { error: 'Failed to update person' },
        { status: 500 }
      );
    }

    return NextResponse.json(person);
  } catch (error) {
    console.error('Update person error:', error);
    return NextResponse.json(
      { error: 'Failed to update person' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'id query parameter is required' },
        { status: 400 }
      );
    }

    const success = await deletePerson(id);

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to delete person' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete person error:', error);
    return NextResponse.json(
      { error: 'Failed to delete person' },
      { status: 500 }
    );
  }
}
