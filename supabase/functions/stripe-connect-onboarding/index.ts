import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @18 didn't expose v2.core.* at all (confirmed live: caused "Cannot read
// properties of undefined (reading 'create')") — v2 Core Accounts/Account
// Links support only landed in stripe-node's more recent major versions.
// Bumped to @22. Check https://github.com/stripe/stripe-node/releases if
// v2.core.* calls ever come back undefined again after a future bump.
import Stripe from 'npm:stripe@22';

import { resolveConnectOwnerForUser, persistStripeAccountId, createOnboardingAccountLink } from '../_shared/connect.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Verify JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const token = authHeader.replace('Bearer ', '');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) throw new Error('Unauthorized');

    const { data: profile } = await supabase.from('profiles')
      .select('roles, display_name, organisation_id')
      .eq('id', user.id).single();
    if (!profile?.roles?.includes('organiser')) throw new Error('Forbidden: organiser role required');

    // 2. Parse body — country is only required the first time (account
    // creation); ignored on every later call ("continue onboarding").
    const { country } = await req.json().catch(() => ({ country: undefined }));

    // 3. Resolve who owns this Connect account (their club's shared account,
    // or their own — see _shared/connect.ts).
    const owner = await resolveConnectOwnerForUser(supabase, user.id);
    if (!owner) throw new Error('Could not resolve organiser/organisation profile');

    // Pinned to the .preview version, not left to auto-negotiate: this
    // function requests configuration.recipient.capabilities.bank_accounts
    // at account creation below, and Stripe rejected that field on the
    // account's stable default version (confirmed live: "This matches an
    // existing preview-only field... explicitly specify a .preview
    // Stripe-Version"). accountLinks.create (also called in this file) has
    // no such requirement, so pinning the whole client here is safe.
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2026-06-24.preview' });
    let accountId = owner.stripe_account_id;

    if (!accountId) {
      if (!country) throw new Error('Missing country — required to start Stripe onboarding');

      let displayName = profile.display_name || user.email || 'Fur to Feathers organiser';
      if (owner.ownerType === 'organisation') {
        const { data: org } = await supabase.from('organisations').select('name').eq('id', owner.ownerId).single();
        displayName = org?.name || displayName;
      }

      // Standard-equivalent account under Stripe's V2 Accounts API: no
      // top-level `type` — the shape below (dashboard: 'full' +
      // fees_collector/losses_collector both 'stripe') is what makes Stripe,
      // not this platform, responsible for Stripe's own fees and for
      // dispute/chargeback losses. Do not change either responsibilities
      // value to 'application'.
      const account = await (stripe as any).v2.core.accounts.create({
        display_name: displayName,
        contact_email: user.email,
        identity: { country },
        dashboard: 'full',
        defaults: {
          responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
        },
        // No `recipient` configuration: that's for indirect-charge money
        // movement (receiving transfers from the platform or other merchant
        // accounts) via stripe_balance.stripe_transfers — not our model.
        // We use Direct charges, so the organiser's account is the merchant
        // of record and this `merchant` capability alone is what creates
        // its own Stripe balance and standard payout behaviour. Confirmed
        // live: requesting `recipient.capabilities.bank_accounts` failed
        // twice (preview-only field, then Global-Payouts-gated) before this
        // simplification, matching Stripe's own docs that `recipient` is
        // unrelated to standard same-account Direct-charge payouts.
        configuration: {
          customer: {},
          merchant: { capabilities: { card_payments: { requested: true } } },
        },
      });

      accountId = account.id;
      await persistStripeAccountId(supabase, owner, accountId!, country);
    }

    // 4. Always (re-)issue an Account Link — also how "continue onboarding"
    // works for an incomplete or expired prior link.
    const siteUrl = Deno.env.get('SITE_URL') || 'https://www.furtofeathers.com';
    const url = await createOnboardingAccountLink(stripe, accountId!, siteUrl);

    return new Response(
      JSON.stringify({ url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
