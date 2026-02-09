import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import {
  isAvailable,
  listTables,
  importFromTable,
  enrichCandidate,
  type ClayColumnMapping,
} from '@/lib/clay';
import { addCandidate } from '@/lib/envoy';
import { supabaseAdmin } from '@/lib/supabase';
import type { EnvoyPipeline, EnvoyCandidate } from '@/types';

/**
 * GET /api/envoy/clay
 * Check Clay connection status and list available tables.
 *
 * POST /api/envoy/clay
 * Import candidates from a Clay table or enrich existing candidates.
 *
 * Actions:
 *   import — pull rows from a Clay table into an Envoy pipeline
 *   enrich — enrich a specific candidate with Clay data
 *   enrich_all — enrich all approved candidates missing Clay data
 */

export async function GET() {
  try {
    const available = isAvailable();

    if (!available) {
      return NextResponse.json({
        connected: false,
        message: 'CLAY_API_KEY not configured. Add it to your environment variables.',
        tables: [],
      });
    }

    const tables = await listTables();

    return NextResponse.json({
      connected: true,
      tables,
    });
  } catch (error) {
    console.error('Clay status error:', error);
    return NextResponse.json(
      { error: 'Failed to check Clay status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const body = await request.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json(
        { error: 'action is required (import, enrich, enrich_all)' },
        { status: 400 }
      );
    }

    if (!isAvailable()) {
      return NextResponse.json(
        { error: 'Clay integration not configured. Set CLAY_API_KEY.' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'import': {
        const { table_id, pipeline, source_pool, column_mapping, limit } = body;

        if (!table_id || !pipeline || !source_pool) {
          return NextResponse.json(
            { error: 'table_id, pipeline, and source_pool are required for import' },
            { status: 400 }
          );
        }

        const { candidates, total } = await importFromTable(
          table_id,
          pipeline as EnvoyPipeline,
          source_pool,
          column_mapping as ClayColumnMapping | undefined,
          limit || 100
        );

        // Insert candidates into the database
        let imported = 0;
        for (const candidateData of candidates) {
          const result = await addCandidate(userId, candidateData);
          if (result) imported++;
        }

        return NextResponse.json({
          success: true,
          fetched: total,
          imported,
          skipped: total - imported,
        });
      }

      case 'enrich': {
        const { candidate_id } = body;

        if (!candidate_id) {
          return NextResponse.json(
            { error: 'candidate_id is required for enrich' },
            { status: 400 }
          );
        }

        const { data: candidate } = await supabaseAdmin
          .from('envoy_candidates')
          .select('*')
          .eq('id', candidate_id)
          .eq('user_id', userId)
          .single();

        if (!candidate) {
          return NextResponse.json(
            { error: 'Candidate not found' },
            { status: 404 }
          );
        }

        const updates = await enrichCandidate(candidate as EnvoyCandidate);

        if (updates) {
          const sourceDetail = candidate.source_detail
            ? `${candidate.source_detail} | Clay enriched`
            : 'Clay enriched';

          await supabaseAdmin
            .from('envoy_candidates')
            .update({ ...updates, source_detail: sourceDetail })
            .eq('id', candidate_id);

          return NextResponse.json({
            success: true,
            enriched: true,
            fields_updated: Object.keys(updates),
          });
        }

        return NextResponse.json({
          success: true,
          enriched: false,
          message: 'No additional data found in Clay',
        });
      }

      case 'enrich_all': {
        const { data: candidates } = await supabaseAdmin
          .from('envoy_candidates')
          .select('*')
          .eq('user_id', userId)
          .eq('excluded', false)
          .not('source_detail', 'ilike', '%Clay enriched%');

        if (!candidates || candidates.length === 0) {
          return NextResponse.json({
            success: true,
            enriched: 0,
            message: 'All candidates already enriched',
          });
        }

        let enriched = 0;
        for (const candidate of candidates) {
          const updates = await enrichCandidate(candidate as EnvoyCandidate);
          if (updates) {
            const sourceDetail = candidate.source_detail
              ? `${candidate.source_detail} | Clay enriched`
              : 'Clay enriched';

            await supabaseAdmin
              .from('envoy_candidates')
              .update({ ...updates, source_detail: sourceDetail })
              .eq('id', candidate.id);

            enriched++;
          }
        }

        return NextResponse.json({
          success: true,
          enriched,
          total_checked: candidates.length,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Clay action error:', error);
    return NextResponse.json(
      { error: 'Failed to process Clay action' },
      { status: 500 }
    );
  }
}
