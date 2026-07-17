import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Called daily by a pg_cron + pg_net job (see the
// 20260717b_goal_reminder.sql migration) — not a public-facing function, so
// this deploys WITHOUT --no-verify-jwt. The cron job authenticates with the
// project's service_role key (via Supabase Vault, never committed), which
// passes Supabase's default JWT verification like any other valid token.

function esc(s: unknown) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mirrors src/lib/fees.js — duplicated here since this Deno function can't
// import a Vite-bundled frontend module (same reasoning as stripe-webhook).
function organiserNet(total: number, currency: string, settings: Record<string, number>): number | null {
  const pct = settings['service_fee_pct'];
  const floor = settings[`service_fee_floor_${currency}`];
  if (pct == null || floor == null) return null;
  const platformFee = Math.max(floor, total * pct / 100);

  const stripePct = settings['stripe_fee_pct'];
  const stripeFixed = settings[`stripe_fee_fixed_${currency}`];
  if (stripePct == null || stripeFixed == null) return null;
  const stripeFee = total * stripePct / 100 + stripeFixed;

  return Math.max(0, total - platformFee - stripeFee);
}

// Mirrors src/lib/fees.js. Persists Resend's used-quota headers, same as
// every other Resend-sending function in this project — keep in sync.
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

serve(async (_req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromAddr  = Deno.env.get('RESEND_FROM') || 'Fur to Feathers <noreply@furtofeathers.com>';
    const siteUrl   = Deno.env.get('SITE_URL') || 'https://www.furtofeathers.com';
    if (!resendKey) throw new Error('RESEND_API_KEY secret is not set');

    const { data: settingsRows } = await supabase
      .from('platform_settings')
      .select('key, value')
      .or('key.eq.goal_reminder_days_before,key.like.service_fee_%,key.like.stripe_fee_%');
    const settings: Record<string, number> = {};
    for (const r of (settingsRows || [])) settings[r.key] = parseFloat(r.value) || 0;
    const daysBefore = settings['goal_reminder_days_before'] || 3;

    // Coarse date-only pre-filter (ignores each show's own timezone — fine for
    // a "heads up" nudge, not for anything that gates entries). Show Day must
    // be between today and daysBefore days out, and the reminder not already sent.
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() + daysBefore * 86400000).toISOString().slice(0, 10);

    const { data: candidates, error } = await supabase
      .from('shows')
      .select('id, title, contact_email, entry_fee, currency, fundraising_goal, fundraising_goal_type, show_date')
      .eq('status', 'published')
      .eq('close_entries_on_goal', true)
      .is('entries_closed_at', null)
      .is('goal_reminder_sent_at', null)
      .not('fundraising_goal', 'is', null)
      .gte('show_date', today)
      .lte('show_date', cutoff);

    if (error) throw new Error('Failed to load candidate shows: ' + error.message);

    let sent = 0, skipped = 0;

    for (const show of (candidates || [])) {
      if (!show.contact_email) { skipped++; continue; }

      const { count } = await supabase
        .from('show_entries')
        .select('id', { count: 'exact', head: true }).eq('show_id', show.id).eq('status', 'confirmed');
      const confirmedCount = count || 0;

      let current: number;
      if (show.fundraising_goal_type === 'entries') {
        current = confirmedCount;
      } else {
        const netPerEntry = organiserNet(show.entry_fee || 0, show.currency || 'AUD', settings) ?? 0;
        current = confirmedCount * netPerEntry;
      }

      // Goal already met — the webhook should have closed entries already;
      // this is just a safety net so we never nag about a goal that's done.
      if (current >= show.fundraising_goal) { skipped++; continue; }

      const isEntries = show.fundraising_goal_type === 'entries';
      const sym = { AUD: 'A$', NZD: 'NZ$', GBP: '£', USD: '$', EUR: '€', CAD: 'C$', SGD: 'S$', ZAR: 'R' }[show.currency] || '';
      const progressText = isEntries
        ? `${confirmedCount} of ${show.fundraising_goal} entries`
        : `${sym}${current.toFixed(2)} of ${sym}${Number(show.fundraising_goal).toFixed(2)} raised`;

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: fromAddr,
          to: [show.contact_email],
          subject: `Heads up: "${show.title}" hasn't hit its goal yet`,
          html: `
            <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1c1626;padding:20px 0">
              <p style="font-size:15px;margin:0 0 12px">Your show <strong>${esc(show.title)}</strong> is coming up on ${esc(show.show_date)}, and entries are still set to close automatically once its fundraising goal is reached.</p>
              <p style="font-size:15px;margin:0 0 12px">Currently at <strong>${esc(progressText)}</strong>.</p>
              <p style="font-size:15px;margin:0 0 12px">If the goal isn't reached by Show Day, entries will close then regardless. You can adjust the goal, turn off auto-close, or close entries manually any time before then.</p>
              <p style="font-size:15px;margin:16px 0 0"><a href="${siteUrl}/organiser/show?id=${show.id}" style="color:#1ba89a;font-weight:700">Review this show →</a></p>
            </div>
          `,
        }),
      });

      await persistResendQuota(supabase, emailRes);
      if (!emailRes.ok) { skipped++; continue; }

      await supabase.from('shows').update({ goal_reminder_sent_at: new Date().toISOString() }).eq('id', show.id);
      sent++;
    }

    return new Response(JSON.stringify({ checked: (candidates || []).length, sent, skipped }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('send-goal-reminder failed:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
