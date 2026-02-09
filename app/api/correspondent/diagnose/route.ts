import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/correspondent/diagnose
 * Diagnostic endpoint to debug Gmail API connectivity issues.
 * Returns detailed info about token status, API calls, and configuration.
 */

export async function GET(request: NextRequest) {
  const diagnostics: Record<string, any> = {
    timestamp: new Date().toISOString(),
    checks: {},
  };

  const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
  diagnostics.user_id = userId;

  // Check 1: Environment variables
  diagnostics.checks.env = {
    DEFAULT_USER_ID: !!process.env.DEFAULT_USER_ID,
    GMAIL_CLIENT_ID: !!process.env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: !!process.env.GMAIL_CLIENT_SECRET,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'NOT SET',
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
  };

  // Check 2: Config record in database
  try {
    const { data: config, error } = await supabaseAdmin
      .from('correspondent_config')
      .select('gmail_connected, gmail_token_expiry, gmail_access_token, gmail_refresh_token, excluded_emails')
      .eq('user_id', userId)
      .single();

    if (error) {
      diagnostics.checks.config = { error: error.message, code: error.code };
    } else if (!config) {
      diagnostics.checks.config = { error: 'No config record found for user' };
    } else {
      diagnostics.checks.config = {
        gmail_connected: config.gmail_connected,
        has_access_token: !!config.gmail_access_token,
        has_refresh_token: !!config.gmail_refresh_token,
        token_expiry: config.gmail_token_expiry,
        token_expired: config.gmail_token_expiry ? new Date(config.gmail_token_expiry) < new Date() : 'no expiry set',
        token_expires_in_minutes: config.gmail_token_expiry
          ? Math.round((new Date(config.gmail_token_expiry).getTime() - Date.now()) / 60000)
          : null,
        excluded_emails_count: config.excluded_emails?.length || 0,
      };

      // Check 3: Try refreshing the token if expired
      if (config.gmail_token_expiry && new Date(config.gmail_token_expiry) < new Date()) {
        diagnostics.checks.token_refresh = { status: 'attempting refresh...' };

        if (config.gmail_refresh_token) {
          try {
            const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: process.env.GMAIL_CLIENT_ID!,
                client_secret: process.env.GMAIL_CLIENT_SECRET!,
                refresh_token: config.gmail_refresh_token,
                grant_type: 'refresh_token',
              }),
            });

            if (refreshResponse.ok) {
              const tokenData = await refreshResponse.json();
              const newExpiry = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

              // Store the refreshed token
              await supabaseAdmin
                .from('correspondent_config')
                .update({
                  gmail_access_token: tokenData.access_token,
                  gmail_token_expiry: newExpiry,
                })
                .eq('user_id', userId);

              diagnostics.checks.token_refresh = {
                status: 'success',
                new_expiry: newExpiry,
              };

              // Use the new token for the Gmail test
              config.gmail_access_token = tokenData.access_token;
            } else {
              const errorText = await refreshResponse.text();
              diagnostics.checks.token_refresh = {
                status: 'failed',
                http_status: refreshResponse.status,
                error: errorText,
              };
            }
          } catch (refreshErr: any) {
            diagnostics.checks.token_refresh = {
              status: 'error',
              error: refreshErr.message,
            };
          }
        } else {
          diagnostics.checks.token_refresh = {
            status: 'skipped',
            reason: 'No refresh token stored. User needs to re-authorize Gmail.',
          };
        }
      }

      // Check 4: Test Gmail API call
      if (config.gmail_access_token) {
        try {
          // Simple profile fetch to test token validity
          const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
            headers: { Authorization: `Bearer ${config.gmail_access_token}` },
          });

          if (profileRes.ok) {
            const profile = await profileRes.json();
            diagnostics.checks.gmail_api = {
              status: 'connected',
              email: profile.emailAddress,
              messages_total: profile.messagesTotal,
              threads_total: profile.threadsTotal,
            };
          } else {
            const errorText = await profileRes.text();
            diagnostics.checks.gmail_api = {
              status: 'failed',
              http_status: profileRes.status,
              error: errorText,
            };
          }
        } catch (apiErr: any) {
          diagnostics.checks.gmail_api = {
            status: 'error',
            error: apiErr.message,
          };
        }

        // Check 5: Test message listing (same query as the pipeline)
        try {
          const sinceEpoch = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
          const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
          listUrl.searchParams.set('q', `after:${sinceEpoch} in:inbox`);
          listUrl.searchParams.set('maxResults', '5');

          const listRes = await fetch(listUrl.toString(), {
            headers: { Authorization: `Bearer ${config.gmail_access_token}` },
          });

          if (listRes.ok) {
            const listData = await listRes.json();
            diagnostics.checks.gmail_messages = {
              status: 'success',
              query: `after:${sinceEpoch} in:inbox`,
              result_count: listData.messages?.length || 0,
              result_size_estimate: listData.resultSizeEstimate,
              sample_ids: listData.messages?.slice(0, 3).map((m: any) => m.id) || [],
            };
          } else {
            const errorText = await listRes.text();
            diagnostics.checks.gmail_messages = {
              status: 'failed',
              http_status: listRes.status,
              error: errorText,
            };
          }
        } catch (listErr: any) {
          diagnostics.checks.gmail_messages = {
            status: 'error',
            error: listErr.message,
          };
        }
      }
    }
  } catch (err: any) {
    diagnostics.checks.config = { error: err.message };
  }

  // Check 6: Existing messages in DB
  try {
    const { count } = await supabaseAdmin
      .from('correspondent_messages')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    diagnostics.checks.db_messages = { count: count || 0 };
  } catch (err: any) {
    diagnostics.checks.db_messages = { error: err.message };
  }

  return NextResponse.json(diagnostics, { status: 200 });
}
