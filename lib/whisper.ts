import OpenAI from 'openai';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
  });
}

export async function transcribeAudio(audioBuffer: Buffer, filename: string): Promise<string> {
  // Write buffer to temporary file
  const tempPath = join(tmpdir(), `${Date.now()}-${filename}`);

  try {
    await writeFile(tempPath, audioBuffer);

    // Create a file object for OpenAI
    const file = await fetch(`file://${tempPath}`).then(res => res.blob()).then(blob => new File([blob], filename));

    // Transcribe with Whisper
    const transcription = await getOpenAI().audio.transcriptions.create({
      file: file as any,
      model: 'whisper-1',
      language: 'en',
    });

    return transcription.text;
  } finally {
    // Clean up temp file
    try {
      await unlink(tempPath);
    } catch (e) {
      console.error('Failed to delete temp file:', e);
    }
  }
}

// Alternative implementation using fs.createReadStream for Node.js environments
export async function transcribeAudioStream(audioPath: string): Promise<string> {
  const fs = await import('fs');
  const transcription = await getOpenAI().audio.transcriptions.create({
    file: fs.createReadStream(audioPath) as any,
    model: 'whisper-1',
    language: 'en',
  });

  return transcription.text;
}
