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
    const { token } = await req.json();
    if (!token) throw new Error('Missing token');

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Find the vote row — must be unconfirmed and not expired
    const { data: vote, error: findErr } = await adminClient
      .from('public_votes')
      .select('id, show_id, confirmed_at, token_expires_at')
      .eq('vote_token', token)
      .single();

    if (findErr || !vote) {
      return new Response(
        JSON.stringify({ error: 'invalid_or_expired' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }

    // Already confirmed — idempotent success
    if (vote.confirmed_at) {
      return new Response(
        JSON.stringify({ error: 'already_confirmed', show_id: vote.show_id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }

    // Expired token
    if (new Date(vote.token_expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'invalid_or_expired' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }

    // Confirm the vote
    const { error: updateErr } = await adminClient
      .from('public_votes')
      .update({ confirmed_at: new Date().toISOString() })
      .eq('id', vote.id);

    if (updateErr) throw new Error('Failed to confirm vote: ' + updateErr.message);

    return new Response(
      JSON.stringify({ success: true, show_id: vote.show_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    );
  }
});
