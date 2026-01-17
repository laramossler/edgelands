'use client';

import { useState, useRef } from 'react';

interface VoiceUploadProps {
  onUploadComplete?: (result: { transcript: string; insights: string[] }) => void;
}

export default function VoiceUpload({ onUploadComplete }: VoiceUploadProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await uploadAudio(blob, 'recording.webm');

        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setError(null);
      setSuccess(null);
    } catch (err) {
      setError('Failed to start recording. Please check microphone permissions.');
      console.error(err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    await uploadAudio(file, file.name);
  };

  const uploadAudio = async (file: Blob, filename: string) => {
    setIsUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append('audio', file, filename);

      const response = await fetch('/api/voice', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();
      setSuccess(`Captured: ${result.insights[0] || 'Voice memo processed'}`);

      if (onUploadComplete) {
        onUploadComplete(result);
      }

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError('Failed to process voice memo. Please try again.');
      console.error(err);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        {/* Record button */}
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isUploading}
          className={`flex-1 py-3 px-4 rounded font-medium transition-colors ${
            isRecording
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-accent text-background hover:bg-accent/90'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isRecording ? '⏹ Stop Recording' : '🎤 Record Voice Memo'}
        </button>

        {/* Upload button */}
        <label className="flex-1 py-3 px-4 rounded font-medium bg-muted/20 text-foreground hover:bg-muted/30 transition-colors text-center cursor-pointer">
          📤 Upload Audio
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={handleFileSelect}
            disabled={isUploading || isRecording}
            className="hidden"
          />
        </label>
      </div>

      {/* Status messages */}
      {isUploading && (
        <div className="text-center text-muted text-sm">Processing voice memo...</div>
      )}

      {error && (
        <div className="text-red-400 text-sm border border-red-400/20 rounded p-3">
          {error}
        </div>
      )}

      {success && (
        <div className="text-accent text-sm border border-accent/20 rounded p-3">
          {success}
        </div>
      )}
    </div>
  );
}
