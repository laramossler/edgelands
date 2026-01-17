import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio } from '@/lib/whisper';
import { analyzeVoiceMemo } from '@/lib/claude';
import { supabaseAdmin, db } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      );
    }

    // TODO: Get actual user ID from auth session
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';

    // Convert file to buffer
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase Storage
    const filename = `${userId}/${Date.now()}-${audioFile.name}`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('voice-memos')
      .upload(filename, buffer, {
        contentType: audioFile.type,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
    }

    const audioUrl = uploadData?.path
      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/voice-memos/${uploadData.path}`
      : undefined;

    // Transcribe with Whisper
    const transcript = await transcribeAudio(buffer, audioFile.name);

    // Analyze with Claude
    const { content, tags } = await analyzeVoiceMemo(transcript);

    // Save integration
    const { data: integration } = await db.createIntegration(userId, {
      source: 'voice_memo',
      content,
      transcript,
      tags,
      audio_url: audioUrl,
    });

    const integrationId = integration?.[0]?.id || 'unknown';

    return NextResponse.json({
      transcript,
      insights: [content],
      integrationId,
    });
  } catch (error) {
    console.error('Voice API error:', error);
    return NextResponse.json(
      { error: 'Failed to process voice memo' },
      { status: 500 }
    );
  }
}
