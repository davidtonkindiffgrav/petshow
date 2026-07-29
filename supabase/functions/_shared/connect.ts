// Resolves "whose Stripe Connect account does this belong to" — the single
// source of truth reused by create-checkout-session, stripe-connect-
// onboarding, and stripe-connect-webhook. Account scope is per-organiser or
// per-club, never per-show: a club organiser's account lives on their
// organisations row (shared by every member), an individual organiser's
// lives on their own profiles row. Mirrors how organiser/settings.astro
// already resolves club vs individual organisers for the org-name field.

const CONNECT_FIELDS = 'stripe_account_id, stripe_account_country, stripe_card_payments_status, stripe_charges_ready, stripe_payouts_ready';

export type ConnectOwner = {
  ownerType: 'organisation' | 'profile';
  ownerId: string;
  stripe_account_id: string | null;
  stripe_account_country: string | null;
  stripe_card_payments_status: string | null;
  stripe_charges_ready: boolean;
  stripe_payouts_ready: boolean;
};

// For a given show, resolve the Connect account that should process its
// entry fees: the show's organisation if it has one, else its creator's
// own profile.
export async function resolveConnectOwnerForShow(
  supabase: any,
  show: { organisation_id: string | null; created_by: string },
): Promise<ConnectOwner | null> {
  if (show.organisation_id) {
    const { data } = await supabase.from('organisations').select(CONNECT_FIELDS).eq('id', show.organisation_id).single();
    if (!data) return null;
    return { ownerType: 'organisation', ownerId: show.organisation_id, ...data };
  }
  const { data } = await supabase.from('profiles').select(CONNECT_FIELDS).eq('id', show.created_by).single();
  if (!data) return null;
  return { ownerType: 'profile', ownerId: show.created_by, ...data };
}

// For the signed-in organiser calling stripe-connect-onboarding directly
// (no specific show in play) — resolve their own account the same way:
// their club's shared account if they belong to one, else their own.
export async function resolveConnectOwnerForUser(supabase: any, userId: string): Promise<ConnectOwner | null> {
  const { data: profile } = await supabase.from('profiles').select(`organisation_id, ${CONNECT_FIELDS}`).eq('id', userId).single();
  if (!profile) return null;
  if (profile.organisation_id) {
    const { data } = await supabase.from('organisations').select(CONNECT_FIELDS).eq('id', profile.organisation_id).single();
    if (!data) return null;
    return { ownerType: 'organisation', ownerId: profile.organisation_id, ...data };
  }
  return { ownerType: 'profile', ownerId: userId, ...profile };
}

export async function persistStripeAccountId(supabase: any, owner: ConnectOwner, accountId: string, country: string) {
  const table = owner.ownerType === 'organisation' ? 'organisations' : 'profiles';
  const { error } = await supabase.from(table)
    .update({ stripe_account_id: accountId, stripe_account_country: country })
    .eq('id', owner.ownerId);
  if (error) throw new Error(`Failed to save Stripe account id: ${error.message}`);
}

// Computes an account's capability status from a live Stripe fetch — same
// interpretation of configuration.merchant.capabilities used by
// stripe-connect-webhook's v2.core.account[...] thin-events handler.
// Factored out so stripe-connect-status (a synchronous fetch-on-return) can
// share it: that webhook's "Connected accounts" event destination —
// correctly configured, event types matching, Ping succeeding — never once
// delivered a real account event in live mode during the 29 Jul 2026 cutover
// test, while the platform checkout webhook on the same account worked
// fine. Scoped to the v2 preview thin-events path specifically, not a
// broader Connect problem, so don't wait on that webhook alone for the
// "onboarding just completed" moment.
export function computeConnectStatus(account: any) {
  const cardPaymentsStatus: string | null = account.configuration?.merchant?.capabilities?.card_payments?.status ?? null;
  const payoutsStatus: string | null = account.configuration?.merchant?.capabilities?.stripe_balance?.payouts?.status ?? null;
  return {
    stripe_card_payments_status: cardPaymentsStatus,
    stripe_charges_ready: cardPaymentsStatus === 'active',
    stripe_payouts_ready: payoutsStatus === 'active',
    stripe_account_updated_at: new Date().toISOString(),
  };
}

export async function refreshConnectStatusFromStripe(supabase: any, stripe: any, table: 'organisations' | 'profiles', ownerId: string, accountId: string) {
  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ['configuration.merchant', 'configuration.recipient', 'requirements'],
  });
  const updates = computeConnectStatus(account);
  const { error } = await supabase.from(table).update(updates).eq('id', ownerId);
  if (error) throw new Error(`Failed to save Connect status: ${error.message}`);
  return updates;
}

// Shared by stripe-connect-onboarding (organiser self-serve) and admin-api's
// connect-resend-onboarding-link (admin-triggered) — issuing a fresh Account
// Link against an existing account is also the normal way to resume
// incomplete onboarding or replace an expired link.
export async function createOnboardingAccountLink(stripe: any, accountId: string, siteUrl: string): Promise<string> {
  const accountLink = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['merchant', 'customer'],
        refresh_url: `${siteUrl}/organiser/settings?connect=refresh`,
        return_url: `${siteUrl}/organiser/settings?connect=return`,
      },
    },
  });
  return accountLink.url;
}
