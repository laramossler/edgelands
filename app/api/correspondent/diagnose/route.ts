import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/correspondent/diagnose
 * Diagnostic endpoint to debug Gmail API connectivity issues.
 * Returns detailed info about token status, API calls, and configuration.
 *
 * GET /api/correspondent/diagnose?fix=true
 * Auto-fix: adopt orphaned config rows and refresh expired tokens.
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const autoFix = searchParams.get('fix') === 'true';

  const diagnostics: Record<string, any> = {
    timestamp: new Date().toISOString(),
    checks: {},
    fixes_applied: [],
  };

  const userId = process.env.DEFAULT_USER_ID || 'placeholder-user-id';
  diagnostics.user_id = userId;

  // Check 1: Environment variables
  diagnostics.checks.env = {
    DEFAULT_USER_ID: !!process.env.DEFAULT_USER_ID,
    DEFAULT_USER_ID_value: userId,
    GMAIL_CLIENT_ID: !!process.env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: !!process.env.GMAIL_CLIENT_SECRET,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'NOT SET',
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
  };

  // Check 2: ALL config rows in database (find orphaned ones)
  try {
    const { data: allConfigs, error: allError } = await supabaseAdmin
      .from('correspondent_config')
      .select('user_id, gmail_connected, gmail_token_expiry, gmail_access_token, gmail_refresh_token');

    if (allError) {
      diagnostics.checks.all_configs = { error: allError.message, code: allError.code };
    } else {
      diagnostics.checks.all_configs = {
        total_rows: allConfigs?.length || 0,
        rows: (allConfigs || []).map(c => ({
          user_id: c.user_id,
          gmail_connected: c.gmail_connected,
          has_access_token: !!c.gmail_access_token,
          has_refresh_token: !!c.gmail_refresh_token,
          token_expiry: c.gmail_token_expiry,
          is_target_user: c.user_id === userId,
        })),
      };

      // Auto-fix: if no config for target user but orphaned rows exist, adopt them
      const targetConfig = allConfigs?.find(c => c.user_id === userId);
      const orphanedConfig = allConfigs?.find(c => c.user_id !== userId && c.gmail_connected);

      if (!targetConfig && orphanedConfig && autoFix) {
        const { error: fixError } = await supabaseAdmin
          .from('correspondent_config')
          .update({ user_id: userId })
          .eq('user_id', orphanedConfig.user_id);

        if (fixError) {
          diagnostics.fixes_applied.push({ action: 'adopt_orphan', error: fixError.message });
        } else {
          diagnostics.fixes_applied.push({
            action: 'adopt_orphan',
            old_user_id: orphanedConfig.user_id,
            new_user_id: userId,
            status: 'success',
          });
          // Use the orphaned config for subsequent checks
          Object.assign(orphanedConfig, { user_id: userId });
        }
      } else if (!targetConfig && orphanedConfig) {
        diagnostics.checks.suggestion = `Found orphaned config with user_id="${orphanedConfig.user_id}". Add ?fix=true to auto-adopt it.`;
      }
    }
  } catch (err: any) {
    diagnostics.checks.all_configs = { error: err.message };
  }

  // Check 3: Config record for this specific user
  let config: any = null;
  try {
    const { data, error } = await supabaseAdmin
      .from('correspondent_config')
      .select('gmail_connected, gmail_token_expiry, gmail_access_token, gmail_refresh_token, excluded_emails')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      diagnostics.checks.config = { error: error.message, code: error.code };
    } else if (!data) {
      diagnostics.checks.config = { error: 'No config record found for this user_id' };
    } else {
      config = data;
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
    }
  } catch (err: any) {
    diagnostics.checks.config = { error: err.message };
  }

  // Check 4: Try refreshing the token if expired
  if (config?.gmail_token_expiry && new Date(config.gmail_token_expiry) < new Date()) {
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

          await supabaseAdmin
            .from('correspondent_config')
            .update({
              gmail_access_token: tokenData.access_token,
              gmail_token_expiry: newExpiry,
            })
            .eq('user_id', userId);

          diagnostics.checks.token_refresh = { status: 'success', new_expiry: newExpiry };
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
        diagnostics.checks.token_refresh = { status: 'error', error: refreshErr.message };
      }
    } else {
      diagnostics.checks.token_refresh = {
        status: 'skipped',
        reason: 'No refresh token stored. Re-authorize Gmail at /api/correspondent/oauth',
      };
    }
  }

  // Check 5: Test Gmail API call
  if (config?.gmail_access_token) {
    try {
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
      diagnostics.checks.gmail_api = { status: 'error', error: apiErr.message };
    }

    // Check 6: Test message listing
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
      diagnostics.checks.gmail_messages = { status: 'error', error: listErr.message };
    }
  }

  // Check 7: Existing messages in DB
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
