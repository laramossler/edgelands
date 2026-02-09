import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/correspondent/oauth
 * Initiate Gmail OAuth2 flow.
 *
 * GET /api/correspondent/oauth?code=<auth_code>
 * Handle OAuth2 callback and store tokens.
 */

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/correspondent/oauth`;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'Gmail OAuth not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.' },
      { status: 500 }
    );
  }

  // Step 1: If no code, redirect to Google's auth page
  if (!code) {
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    return NextResponse.redirect(authUrl.toString());
  }

  // Step 2: Exchange code for tokens
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('OAuth token exchange failed:', error);
      return NextResponse.json(
        { error: 'Failed to exchange authorization code' },
        { status: 400 }
      );
    }

    const tokens = await tokenResponse.json();
    const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
    const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Upsert config with tokens — also check for any orphaned rows with wrong user_id
    const { data: existing } = await supabaseAdmin
      .from('correspondent_config')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!existing) {
      // Check if there's an orphaned row (e.g. created with 'placeholder-user-id')
      const { data: orphaned } = await supabaseAdmin
        .from('correspondent_config')
        .select('user_id')
        .neq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (orphaned) {
        // Adopt the orphaned row by updating its user_id
        await supabaseAdmin
          .from('correspondent_config')
          .update({
            user_id: userId,
            gmail_access_token: tokens.access_token,
            gmail_refresh_token: tokens.refresh_token || undefined,
            gmail_token_expiry: expiry,
            gmail_connected: true,
          })
          .eq('user_id', orphaned.user_id);

        return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?connected=true`);
      }
    }

    if (existing) {
      await supabaseAdmin
        .from('correspondent_config')
        .update({
          gmail_access_token: tokens.access_token,
          gmail_refresh_token: tokens.refresh_token || undefined,
          gmail_token_expiry: expiry,
          gmail_connected: true,
        })
        .eq('user_id', userId);
    } else {
      await supabaseAdmin
        .from('correspondent_config')
        .insert({
          user_id: userId,
          gmail_access_token: tokens.access_token,
          gmail_refresh_token: tokens.refresh_token,
          gmail_token_expiry: expiry,
          gmail_connected: true,
        });
    }

    // Redirect to home page (Morning Dispatch panel)
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?connected=true`);
  } catch (error) {
    console.error('OAuth error:', error);
    return NextResponse.json(
      { error: 'OAuth flow failed' },
      { status: 500 }
    );
  }
}
