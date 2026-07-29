import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@22';

import { resolveConnectOwnerForUser, refreshConnectStatusFromStripe } from '../_shared/connect.ts';

// Called by organiser/settings.astro right after landing on ?connect=return
// — a synchronous "ask Stripe directly" fallback because the v2.core.
// account[...] thin-events webhook (stripe-connect-webhook) turned out not
// to be delivering in live mode despite correct config (see connect.ts).
// Cheap enough to call on every return trip rather than only when the
// webhook is suspected missing.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const token = authHeader.replace('Bearer ', '');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) throw new Error('Unauthorized');

    const owner = await resolveConnectOwnerForUser(supabase, user.id);
    if (!owner?.stripe_account_id) throw new Error('No Stripe account found for this organiser');

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2026-06-24.preview' });
    const table = owner.ownerType === 'organisation' ? 'organisations' : 'profiles';
    const updates = await refreshConnectStatusFromStripe(supabase, stripe, table, owner.ownerId, owner.stripe_account_id);

    return new Response(
      JSON.stringify(updates),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
