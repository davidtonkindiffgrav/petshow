import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Convert a date value + 'HH:MM' wall time in an IANA timezone to a UTC Date.
// Mirrors src/lib/voteWindow.js — keep the two in sync.
function zonedDateTime(dateVal: unknown, timeStr: string | null, timeZone: string | null): Date | null {
  if (!dateVal) return null;
  const [y, m, d] = String(dateVal).slice(0, 10).split('-').map(Number);
  const [hh, mm] = String(timeStr || '0:0').split(':').map(Number);
  if (!y || !m || !d) return null;
  if (!timeZone) return new Date(Date.UTC(y, m - 1, d, hh || 0, mm || 0));

  const target = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    guess += target - wallClockUtc(guess, timeZone);
  }
  return new Date(guess);
}

function wallClockUtc(ts: number, timeZone: string): number {
  const p: Record<string, string> = {};
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ts));
  for (const { type, value } of parts) p[type] = value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
}

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
    const { show_id, voter_email, picks, ip_address, user_agent, browser_fingerprint } = await req.json();
    if (!show_id || !voter_email || !picks?.length) {
      throw new Error('Missing required fields');
    }

    let email = voter_email.trim().toLowerCase();
    if (!email.includes('@')) throw new Error('Invalid email address');

    // Strip Gmail/Outlook/iCloud-style "+tag" sub-addressing before dedup —
    // user+vote1@gmail.com and user+vote2@gmail.com both deliver to the same
    // inbox, so treating them as distinct voters is exactly the loophole this
    // exists to close. Mail still gets there either way, so it's also safe to
    // send to the normalised address rather than the literal typed one.
    {
      const [local, domain] = email.split('@');
      if (domain) email = `${local.split('+')[0]}@${domain}`;
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const siteUrl  = Deno.env.get('SITE_URL') || 'https://www.furtofeathers.com';
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromAddr  = Deno.env.get('RESEND_FROM') || 'Fur to Feathers <noreply@furtofeathers.com>';

    // Verify show exists, accepts public votes, and voting is inside its
    // window. Two kinds of show do: vote shows (is_judged false, every
    // category), and judged shows offering the paid People's Choice add-on
    // (votes restricted to opted-in entries in enabled categories).
    const { data: show, error: showErr } = await adminClient
      .from('shows')
      .select('id, title, is_judged, peoples_choice_fee, vote_open_mode, entry_open_date, entry_open_time, entry_close_date, entry_close_time, show_date, show_time, timezone, results_published_at')
      .eq('id', show_id)
      .single();

    if (showErr || !show) throw new Error('Show not found');
    const isPcShow = show.is_judged === true && show.peoples_choice_fee != null;
    if (show.is_judged !== false && !isPcShow) throw new Error('This show does not use public voting');
    if (show.results_published_at) throw new Error('Voting has closed — results are published');

    const now = new Date();

    // Voting cuts off the moment the show starts (no start time = midnight, start of show day)
    const showStart = zonedDateTime(show.show_date, show.show_time, show.timezone);
    if (showStart && now >= showStart) {
      throw new Error('Voting has closed for this show');
    }

    // Voting opens with entries, or once they close, per the organiser's setting
    const opensAt = show.vote_open_mode === 'on_entries_open'
      ? zonedDateTime(show.entry_open_date, show.entry_open_time, show.timezone)
      : zonedDateTime(show.entry_close_date, show.entry_close_time, show.timezone);
    if (opensAt && now < opensAt) {
      throw new Error(show.vote_open_mode === 'on_entries_open'
        ? 'Voting has not opened yet'
        : 'Voting has not opened yet — entries are still open');
    }

    // On a People's Choice show, every pick must target an enabled category
    // and a confirmed, opted-in entry — reject crafted requests for anything
    // else. (Vote shows accept picks across all confirmed entries, as before.)
    if (isPcShow) {
      const pickCatIds   = [...new Set(picks.map((p: any) => p.category_id))];
      const pickEntryIds = [...new Set(picks.map((p: any) => p.entry_id))];
      const [{ data: pcCats }, { data: pcEntries }] = await Promise.all([
        adminClient.from('show_categories').select('id, has_peoples_choice').in('id', pickCatIds),
        adminClient.from('show_entries')
          .select('id, category_id, status, peoples_choice_fee_amount')
          .eq('show_id', show_id).in('id', pickEntryIds),
      ]);
      const allowedCats = new Set((pcCats || []).filter((c: any) => c.has_peoples_choice).map((c: any) => c.id));
      const entryById = new Map((pcEntries || []).map((e: any) => [e.id, e]));
      for (const p of picks) {
        const entry: any = entryById.get(p.entry_id);
        if (!allowedCats.has(p.category_id)
          || !entry
          || entry.category_id !== p.category_id
          || entry.status !== 'confirmed'
          || entry.peoples_choice_fee_amount == null) {
          throw new Error("One of your picks isn't part of the People's Choice award");
        }
      }
    }

    // Device-level check: the browser_fingerprint is just a random id the
    // client persists in localStorage, not a real hardware fingerprint, so
    // it's beatable by clearing storage or switching browsers — but it stops
    // the casual version of vote-stacking (submitting several emails from
    // the same session/tab without realising the device is already tracked).
    // Only rows under a *different* email matter here — same-email retries
    // are handled by the existing-vote lookup below.
    if (browser_fingerprint) {
      const { data: deviceVotes } = await adminClient
        .from('public_votes')
        .select('confirmed_at, token_expires_at, voter_email')
        .eq('show_id', show_id)
        .eq('browser_fingerprint', browser_fingerprint)
        .neq('voter_email', email);

      if ((deviceVotes || []).some((v: any) => v.confirmed_at)) {
        return new Response(
          JSON.stringify({ error: 'already_voted' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
        );
      }
      if ((deviceVotes || []).some((v: any) => !v.confirmed_at && new Date(v.token_expires_at) > now)) {
        return new Response(
          JSON.stringify({ error: 'already_submitted' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
        );
      }
    }

    // Check for existing vote for this email in this show
    const { data: existing } = await adminClient
      .from('public_votes')
      .select('id, confirmed_at, token_expires_at')
      .eq('show_id', show_id)
      .eq('voter_email', email)
      .maybeSingle();

    if (existing) {
      if (existing.confirmed_at) {
        // Already voted and confirmed
        return new Response(
          JSON.stringify({ error: 'already_voted' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
        );
      }
      if (new Date(existing.token_expires_at) > now) {
        // Pending token still valid — don't resend
        return new Response(
          JSON.stringify({ error: 'already_submitted' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
        );
      }
      // Expired pending token — delete it and re-create
      await adminClient.from('public_votes').delete().eq('id', existing.id);
    }

    // Generate new token valid for 30 minutes
    const token    = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

    // Insert vote row
    const { data: voteRow, error: insertErr } = await adminClient
      .from('public_votes')
      .insert({
        show_id,
        voter_email:         email,
        vote_token:          token,
        token_expires_at:    expiresAt,
        ip_address:          ip_address || null,
        user_agent:          user_agent  || null,
        browser_fingerprint: browser_fingerprint || null,
      })
      .select('id')
      .single();

    if (insertErr || !voteRow) throw new Error('Failed to save vote: ' + insertErr?.message);

    // Insert picks
    const pickRows = picks.map((p: { category_id: string; entry_id: string }) => ({
      vote_id:     voteRow.id,
      category_id: p.category_id,
      entry_id:    p.entry_id,
    }));

    const { error: picksErr } = await adminClient.from('public_vote_picks').insert(pickRows);
    if (picksErr) throw new Error('Failed to save picks: ' + picksErr.message);

    // Send magic link email via Resend
    if (!resendKey) throw new Error('RESEND_API_KEY secret is not set');

    const confirmUrl = `${siteUrl}/vote/confirm?token=${token}`;
    const pickCount  = picks.length;
    const catLabel   = pickCount === 1 ? 'category' : 'categories';
    const voteNoun   = isPcShow ? "People's Choice vote" : 'vote';

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: fromAddr,
        to:   [email],
        subject: `Confirm your ${voteNoun}s — ${show.title}`,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1c1626;padding:20px 0">
            <p style="font-size:16px;margin:0 0 16px">Hi there,</p>
            <p style="font-size:15px;margin:0 0 16px">
              You've cast a ${voteNoun} in <strong>${pickCount} ${catLabel}</strong> at
              <strong>${show.title}</strong>. Click the button below to confirm your votes.
            </p>
            <p style="margin:28px 0">
              <a href="${confirmUrl}"
                style="display:inline-block;padding:14px 28px;background:#1E8E7E;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">
                Confirm My Votes →
              </a>
            </p>
            <p style="font-size:13px;color:#6B7C79;margin:0 0 8px">
              This link expires in 30 minutes and can only be used once.
            </p>
            <p style="font-size:12px;color:#9BB4AF;margin:0">
              We will never send you marketing emails. Your email address is used only
              to verify that each person votes fairly. If you did not request this,
              you can safely ignore this email.
            </p>
          </div>
        `,
      }),
    });

    await persistResendQuota(adminClient, emailRes);
    if (!emailRes.ok) {
      const detail = await emailRes.text();
      throw new Error(`Resend API error ${emailRes.status}: ${detail}`);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    );
  }
});
