import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUBJECT_LABELS: Record<string, string> = {
  general: 'General enquiry',
  show_question: 'Question about a show',
};

function esc(s: unknown) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    const { name, email, subject_type, show_id, message, turnstile_token, xy7q_ref } = await req.json();

    // Honeypot: bots that fill every field get a fake success, never an email.
    // Field name deliberately avoids autofill-matched tokens like "company"/"name" —
    // those got silently populated by real users' saved browser profiles.
    if (xy7q_ref) {
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      throw new Error('Missing required fields');
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes('@')) throw new Error('Invalid email address');

    const subjectType = subject_type === 'show_question' ? 'show_question' : 'general';
    if (subjectType === 'show_question' && !show_id) {
      throw new Error('Please choose a show');
    }

    const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
    if (!turnstileSecret) throw new Error('TURNSTILE_SECRET_KEY secret is not set');
    if (!turnstile_token) throw new Error('Verification failed, please try again.');

    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: turnstileSecret,
        response: turnstile_token,
        remoteip: req.headers.get('x-forwarded-for') || undefined,
      }),
    });
    const verifyResult = await verifyRes.json();
    if (!verifyResult.success) {
      throw new Error('Verification failed, please try again.');
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromAddr  = Deno.env.get('RESEND_FROM') || 'Fur to Feathers <noreply@furtofeathers.com>';
    if (!resendKey) throw new Error('RESEND_API_KEY secret is not set');

    let showTitle: string | null = null;
    if (subjectType === 'show_question') {
      const { data: show } = await adminClient
        .from('shows')
        .select('title')
        .eq('id', show_id)
        .maybeSingle();
      showTitle = show?.title || null;
    }

    const subjectLabel = SUBJECT_LABELS[subjectType];
    const emailSubject = `Contact form: ${subjectLabel}${showTitle ? ' — ' + showTitle : ''}`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: fromAddr,
        to: ['hello@furtofeathers.com'],
        reply_to: [cleanEmail],
        subject: emailSubject,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1c1626;padding:20px 0">
            <p style="font-size:15px;margin:0 0 12px"><strong>Name:</strong> ${esc(name.trim())}</p>
            <p style="font-size:15px;margin:0 0 12px"><strong>Email:</strong> ${esc(cleanEmail)}</p>
            <p style="font-size:15px;margin:0 0 12px"><strong>Subject:</strong> ${esc(subjectLabel)}</p>
            ${showTitle ? `<p style="font-size:15px;margin:0 0 12px"><strong>Show:</strong> ${esc(showTitle)}</p>` : ''}
            <p style="font-size:15px;margin:16px 0 4px"><strong>Message:</strong></p>
            <p style="font-size:15px;margin:0;white-space:pre-wrap">${esc(message.trim())}</p>
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
