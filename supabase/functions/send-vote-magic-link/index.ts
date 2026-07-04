import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { show_id, voter_email, picks, ip_address, user_agent, browser_fingerprint } = await req.json();
    if (!show_id || !voter_email || !picks?.length) {
      throw new Error('Missing required fields');
    }

    const email = voter_email.trim().toLowerCase();
    if (!email.includes('@')) throw new Error('Invalid email address');

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const siteUrl  = Deno.env.get('SITE_URL') || 'https://davidtonkindiffgrav.github.io/petshow';
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromAddr  = Deno.env.get('RESEND_FROM') || 'Fur to Feathers <noreply@furtofeathers.com>';

    // Verify show exists, is public vote, and voting is open (entries closed, not yet published)
    const { data: show, error: showErr } = await adminClient
      .from('shows')
      .select('id, title, is_judged, entry_close_date, results_published_at')
      .eq('id', show_id)
      .single();

    if (showErr || !show) throw new Error('Show not found');
    if (show.is_judged !== false) throw new Error('This show does not use public voting');
    if (show.results_published_at) throw new Error('Voting has closed — results are published');

    const now = new Date();
    if (show.entry_close_date && new Date(show.entry_close_date) > now) {
      throw new Error('Voting has not opened yet — entries are still open');
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

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: fromAddr,
        to:   [email],
        subject: `Confirm your votes — ${show.title}`,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1c1626;padding:20px 0">
            <p style="font-size:16px;margin:0 0 16px">Hi there,</p>
            <p style="font-size:15px;margin:0 0 16px">
              You've voted in <strong>${pickCount} ${catLabel}</strong> at
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
