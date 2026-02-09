import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import {
  addCandidate,
  getCandidates,
  excludeCandidate,
  markResponse,
} from '@/lib/envoy';
import type { EnvoyPipeline } from '@/types';

/**
 * GET /api/envoy/candidates
 * List candidates, optionally filtered by pipeline and/or status.
 *
 * POST /api/envoy/candidates
 * Add a new candidate to a pipeline.
 *
 * PATCH /api/envoy/candidates
 * Update candidate status (exclude, mark response, etc.)
 */

export async function GET(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const { searchParams } = new URL(request.url);
    const pipeline = searchParams.get('pipeline') as EnvoyPipeline | null;
    const status = searchParams.get('status');

    const candidates = await getCandidates(
      userId,
      pipeline || undefined,
      status || undefined
    );

    return NextResponse.json({ candidates, total: candidates.length });
  } catch (error) {
    console.error('Envoy candidates error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch candidates' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const body = await request.json();

    if (!body.name || !body.pipeline) {
      return NextResponse.json(
        { error: 'name and pipeline are required' },
        { status: 400 }
      );
    }

    if (!body.source_pool) {
      return NextResponse.json(
        { error: 'source_pool is required' },
        { status: 400 }
      );
    }

    const candidate = await addCandidate(userId, {
      name: body.name,
      email: body.email,
      role: body.role,
      organization: body.organization,
      location: body.location,
      pipeline: body.pipeline,
      source_pool: body.source_pool,
      source_detail: body.source_detail,
      person_id: body.person_id,
      mutual_connections: body.mutual_connections,
      shared_interests: body.shared_interests,
      their_work: body.their_work,
      why_reach_out: body.why_reach_out,
      what_you_can_offer: body.what_you_can_offer,
      warm_path: body.warm_path,
      warm_intro_through: body.warm_intro_through,
      status: body.status || 'suggested',
      priority: body.priority || 3,
      notes: body.notes,
    });

    if (!candidate) {
      return NextResponse.json(
        { error: 'Failed to add candidate' },
        { status: 500 }
      );
    }

    return NextResponse.json({ candidate }, { status: 201 });
  } catch (error) {
    console.error('Envoy add candidate error:', error);
    return NextResponse.json(
      { error: 'Failed to add candidate' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const body = await request.json();

    if (!body.candidate_id || !body.action) {
      return NextResponse.json(
        { error: 'candidate_id and action are required' },
        { status: 400 }
      );
    }

    let success = false;

    switch (body.action) {
      case 'exclude':
        success = await excludeCandidate(userId, body.candidate_id, body.reason);
        break;
      case 'mark_response':
        success = await markResponse(userId, body.candidate_id);
        break;
      default:
        return NextResponse.json(
          { error: `Unknown action: ${body.action}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ success, action: body.action });
  } catch (error) {
    console.error('Envoy candidate update error:', error);
    return NextResponse.json(
      { error: 'Failed to update candidate' },
      { status: 500 }
    );
  }
}
