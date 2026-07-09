import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Persists Resend's used-quota headers so the admin Email Monitoring page
// can read them without a synthetic probe request — GET requests to
// /domains and /emails don't carry x-resend-daily-quota/-monthly-quota,
// only real POST /emails sends do (confirmed by testing). Mirrors the copy
// in the other Resend-sending functions — keep in sync.
async function persistResendQuota(supabase: any, res: Response) {
  try {
    const daily = res.headers.get('x-resend-daily-quota');
    const monthly = res.headers.get('x-resend-monthly-quota');
    const rows: { key: string; value: string }[] = [];
    if (daily != null) rows.push({ key: 'resend_daily_quota_used', value: daily });
    if (monthly != null) rows.push({ key: 'resend_monthly_quota_used', value: monthly });
    if (rows.length) {
      rows.push({ key: 'resend_quota_checked_at', value: new Date().toISOString() });
      await supabase.from('platform_settings').upsert(rows, { onConflict: 'key' });
    }
  } catch { /* never let quota bookkeeping break the actual email send */ }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Verify JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const token = authHeader.replace('Bearer ', '');

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: { user }, error: authErr } = await adminClient.auth.getUser(token);
    if (authErr || !user) throw new Error('Unauthorized');

    // 2. Parse body
    const { show_id } = await req.json();
    if (!show_id) throw new Error('Missing show_id');

    // 3. Verify caller is the show organiser
    const { data: show, error: showErr } = await adminClient
      .from('shows')
      .select('id, title, created_by')
      .eq('id', show_id)
      .single();
    if (showErr || !show) throw new Error('Show not found');
    if (show.created_by !== user.id) throw new Error('Unauthorized');

    // 4. Get organiser display name
    const { data: organiserProfile } = await adminClient
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .single();
    const organiserName = organiserProfile?.display_name || 'A Fur to Feathers organiser';

    // 5. Get all judges for this show
    const { data: judges, error: judgesErr } = await adminClient
      .from('show_judges')
      .select('id, email, first_name, last_name')
      .eq('show_id', show_id);
    if (judgesErr) throw new Error('Failed to load judges');
    if (!judges?.length) throw new Error('No judges assigned to this show');

    const siteUrl    = Deno.env.get('SITE_URL') || 'https://www.furtofeathers.com';
    const redirectTo = `${siteUrl}/auth/judge-accept`;
    const resendKey  = Deno.env.get('RESEND_API_KEY');
    const fromAddr   = Deno.env.get('RESEND_FROM') || 'Fur to Feathers <noreply@furtofeathers.com>';
    const now        = new Date().toISOString();

    let sentCount    = 0;
    let updatedCount = 0;
    const errors: string[] = [];

    for (const judge of judges) {
      if (!judge.email) continue;

      try {
        const { error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(judge.email, {
          data: {
            first_name:     judge.first_name,
            show_title:     show.title,
            organiser_name: organiserName,
          },
          redirectTo,
        });

        if (!inviteErr) {
          // New user — invite email sent via Supabase SMTP
          await adminClient.from('show_judges').update({ invite_sent_at: now }).eq('id', judge.id);
          sentCount++;
        } else if (
          inviteErr.message?.toLowerCase().includes('already') ||
          inviteErr.message?.toLowerCase().includes('registered') ||
          (inviteErr as any).code === 'user_already_exists'
        ) {
          // Existing user — add judge role and send notification via Resend
          await adminClient.rpc('add_judge_role_by_email', { p_email: judge.email });

          if (!resendKey) throw new Error('RESEND_API_KEY secret is not set');

          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${resendKey}`,
            },
            body: JSON.stringify({
              from: fromAddr,
              to:   [judge.email],
              subject: `You've been added as a judge for ${show.title}`,
              html: `
                <p>Hi ${judge.first_name},</p>
                <p><strong>${organiserName}</strong> has added you as a judge
                   for <strong>${show.title}</strong> on Fur to Feathers.</p>
                <p>Log in to access the judging portal:</p>
                <p><a href="${siteUrl}/judge">${siteUrl}/judge</a></p>
              `,
            }),
          });
          await persistResendQuota(adminClient, emailRes);
          // Previously this response was never checked — a rejected send
          // (e.g. an unverified from-address) was silently marked as sent.
          if (!emailRes.ok) {
            const detail = await emailRes.text();
            throw new Error(`Resend API error ${emailRes.status}: ${detail}`);
          }

          await adminClient.from('show_judges').update({ invite_sent_at: now }).eq('id', judge.id);
          updatedCount++;
        } else {
          errors.push(`${judge.email}: ${inviteErr.message}`);
        }
      } catch (err: any) {
        errors.push(`${judge.email}: ${err.message}`);
      }
    }

    return new Response(
      JSON.stringify({ sent: sentCount, updated: updatedCount, errors }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
