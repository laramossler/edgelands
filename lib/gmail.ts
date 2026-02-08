/**
 * Gmail API Client for the Correspondent Agent
 *
 * Handles OAuth2 token management and message fetching via the Gmail API.
 * Start with read-only scope; add send scope when ready.
 */

import { supabaseAdmin } from './supabase';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailTokens {
  access_token: string;
  refresh_token: string;
  token_expiry: string;
}

interface GmailMessageHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  mimeType: string;
  body: { data?: string; size: number };
  parts?: GmailMessagePart[];
  filename?: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string;
  payload: {
    headers: GmailMessageHeader[];
    mimeType: string;
    body: { data?: string; size: number };
    parts?: GmailMessagePart[];
  };
}

interface GmailListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}

// ============================================================
// Token Management
// ============================================================

async function getTokens(userId: string): Promise<GmailTokens | null> {
  const { data, error } = await supabaseAdmin
    .from('correspondent_config')
    .select('gmail_access_token, gmail_refresh_token, gmail_token_expiry')
    .eq('user_id', userId)
    .single();

  if (error || !data?.gmail_access_token) return null;

  return {
    access_token: data.gmail_access_token,
    refresh_token: data.gmail_refresh_token,
    token_expiry: data.gmail_token_expiry,
  };
}

async function refreshAccessToken(userId: string, refreshToken: string): Promise<string | null> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Gmail OAuth credentials not configured');
    return null;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    console.error('Failed to refresh Gmail token:', await response.text());
    return null;
  }

  const data = await response.json();
  const expiry = new Date(Date.now() + data.expires_in * 1000).toISOString();

  // Store updated token
  await supabaseAdmin
    .from('correspondent_config')
    .update({
      gmail_access_token: data.access_token,
      gmail_token_expiry: expiry,
    })
    .eq('user_id', userId);

  return data.access_token;
}

async function getValidToken(userId: string): Promise<string | null> {
  const tokens = await getTokens(userId);
  if (!tokens) return null;

  // Check if token is expired (with 5-minute buffer)
  const expiry = new Date(tokens.token_expiry);
  const now = new Date(Date.now() + 5 * 60 * 1000);

  if (now >= expiry && tokens.refresh_token) {
    return refreshAccessToken(userId, tokens.refresh_token);
  }

  return tokens.access_token;
}

// ============================================================
// API Helpers
// ============================================================

async function gmailFetch(userId: string, path: string, params?: Record<string, string>): Promise<any | null> {
  const token = await getValidToken(userId);
  if (!token) return null;

  const url = new URL(`${GMAIL_API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    console.error(`Gmail API error (${path}):`, response.status, await response.text());
    return null;
  }

  return response.json();
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function getHeader(headers: GmailMessageHeader[], name: string): string | undefined {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function extractBody(payload: GmailMessage['payload']): { text: string; html: string } {
  let text = '';
  let html = '';

  function walkParts(parts?: GmailMessagePart[]) {
    if (!parts) return;
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body.data) {
        text += decodeBase64Url(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body.data) {
        html += decodeBase64Url(part.body.data);
      }
      if (part.parts) walkParts(part.parts);
    }
  }

  // Simple message
  if (payload.body.data) {
    if (payload.mimeType === 'text/html') {
      html = decodeBase64Url(payload.body.data);
    } else {
      text = decodeBase64Url(payload.body.data);
    }
  }

  // Multipart message
  if (payload.parts) {
    walkParts(payload.parts);
  }

  return { text, html };
}

function extractAttachments(payload: GmailMessage['payload']): { name: string; mime_type: string; size: number }[] {
  const attachments: { name: string; mime_type: string; size: number }[] = [];

  function walkParts(parts?: GmailMessagePart[]) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.filename.length > 0) {
        attachments.push({
          name: part.filename,
          mime_type: part.mimeType,
          size: part.body.size,
        });
      }
      if (part.parts) walkParts(part.parts);
    }
  }

  if (payload.parts) walkParts(payload.parts);
  return attachments;
}

function parseSenderEmail(from: string): { name: string; email: string } {
  const match = from.match(/^(?:"?([^"]*)"?\s)?<?([^>]+@[^>]+)>?$/);
  if (match) {
    return { name: match[1]?.trim() || '', email: match[2].toLowerCase().trim() };
  }
  return { name: '', email: from.toLowerCase().trim() };
}

// ============================================================
// Public API
// ============================================================

export interface IngestedEmail {
  external_id: string;
  thread_id: string;
  sender_email: string;
  sender_name: string;
  subject: string;
  body: string;
  body_html: string;
  snippet: string;
  labels: string[];
  received_at: string;
  attachments: { name: string; mime_type: string; size: number }[];
}

/** Fetch new emails since the given date (or last 24 hours) */
export async function fetchNewEmails(
  userId: string,
  since?: Date,
  maxResults: number = 50
): Promise<IngestedEmail[]> {
  const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sinceEpoch = Math.floor(sinceDate.getTime() / 1000);

  // List messages
  const listData: GmailListResponse | null = await gmailFetch(userId, '/messages', {
    q: `after:${sinceEpoch} in:inbox`,
    maxResults: String(maxResults),
  });

  if (!listData?.messages) return [];

  // Fetch full messages in parallel (batches of 10)
  const emails: IngestedEmail[] = [];
  const messageIds = listData.messages;

  for (let i = 0; i < messageIds.length; i += 10) {
    const batch = messageIds.slice(i, i + 10);
    const results = await Promise.all(
      batch.map(msg =>
        gmailFetch(userId, `/messages/${msg.id}`, { format: 'full' })
      )
    );

    for (const message of results) {
      if (!message) continue;
      const msg = message as GmailMessage;
      const headers = msg.payload.headers;
      const from = getHeader(headers, 'From') || '';
      const sender = parseSenderEmail(from);
      const { text, html } = extractBody(msg.payload);
      const attachments = extractAttachments(msg.payload);

      emails.push({
        external_id: msg.id,
        thread_id: msg.threadId,
        sender_email: sender.email,
        sender_name: sender.name,
        subject: getHeader(headers, 'Subject') || '(no subject)',
        body: text || stripHtml(html),
        body_html: html,
        snippet: msg.snippet,
        labels: msg.labelIds || [],
        received_at: new Date(parseInt(msg.internalDate)).toISOString(),
        attachments,
      });
    }
  }

  return emails;
}

/** Send an email via Gmail API */
export async function sendEmail(
  userId: string,
  to: string,
  subject: string,
  body: string,
  threadId?: string
): Promise<boolean> {
  const token = await getValidToken(userId);
  if (!token) return false;

  // Build RFC 2822 message
  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ];

  const rawMessage = Buffer.from(messageParts.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const requestBody: any = { raw: rawMessage };
  if (threadId) requestBody.threadId = threadId;

  const response = await fetch(`${GMAIL_API_BASE}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    console.error('Failed to send email:', response.status, await response.text());
    return false;
  }

  return true;
}

/** Check if Gmail is connected for this user */
export async function isGmailConnected(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('correspondent_config')
    .select('gmail_connected')
    .eq('user_id', userId)
    .single();

  return data?.gmail_connected === true;
}

/** Get the last history ID for incremental sync */
export async function getLastHistoryId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('correspondent_config')
    .select('gmail_last_history_id')
    .eq('user_id', userId)
    .single();

  return data?.gmail_last_history_id || null;
}

/** Update the last history ID after a sync */
export async function updateLastHistoryId(userId: string, historyId: string): Promise<void> {
  await supabaseAdmin
    .from('correspondent_config')
    .update({ gmail_last_history_id: historyId })
    .eq('user_id', userId);
}

// Simple HTML tag stripper for fallback text extraction
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
