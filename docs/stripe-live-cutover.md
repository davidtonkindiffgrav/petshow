# Stripe: switching between test and live mode

Fur to Feathers uses **Stripe Connect with Direct charges** (V2 Core Accounts). Each organiser — or their club, if they belong to one — has their own connected Stripe account and is the merchant of record; the platform takes a cut via `application_fee_amount` on the Checkout Session. Stripe itself (not the platform) is configured as `fees_collector`/`losses_collector`, so Stripe's own fees and dispute/chargeback losses come out of the connected account automatically.

There is no code that branches on test vs. live mode. Which mode is active is entirely determined by which Stripe secret key is loaded — switching modes is a secrets + Stripe-dashboard operation, not a code change.

## Secrets

Single `STRIPE_SECRET_KEY`, shared across all 6 functions below, plus 3 separate webhook signing secrets (Stripe Connect requires separate webhook destinations per scope — a "Connected accounts" event can't be added to an existing "Your account" destination).

| Secret | Used by |
|---|---|
| `STRIPE_SECRET_KEY` | `create-checkout-session`, `stripe-webhook`, `stripe-connect-onboarding`, `stripe-connect-webhook`, `backfill-entry-net-amount`, `admin-api` |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` — "Your account" destination |
| `STRIPE_CONNECT_CHECKOUT_WEBHOOK_SECRET` | `stripe-webhook` — "Connected accounts" destination |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `stripe-connect-webhook` — "Connected accounts" destination (V2 thin events) |

Set with (`secrets set` has no `--linked` flag — it always targets the linked project):
```
supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... STRIPE_CONNECT_CHECKOUT_WEBHOOK_SECRET=whsec_... STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...
```
Then redeploy the 6 functions above so they pick up the new values. This project has no `supabase/config.toml`, so JWT verification is decided per-deploy by the flag you pass — get this wrong and it fails silently (Stripe's webhook calls start 401'ing at the gateway, but everything else looks fine):

```
supabase functions deploy create-checkout-session
supabase functions deploy stripe-connect-onboarding
supabase functions deploy admin-api
supabase functions deploy backfill-entry-net-amount
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy stripe-connect-webhook --no-verify-jwt
```
`stripe-webhook` and `stripe-connect-webhook` are called directly by Stripe (signed with `stripe-signature`, no Supabase JWT), so they need `--no-verify-jwt`. The other four are called with a real `Authorization: Bearer` token (user session or, for `backfill-entry-net-amount`, the cron's service_role key), so they deploy normally.

Never paste live secret values into chat/AI sessions — run this step yourself, from your own terminal or the Supabase dashboard.

## Webhook destinations

Three destinations, all pointing at the same Edge Function URLs (`https://<project-ref>.supabase.co/functions/v1/<name>`) — Stripe scopes webhooks by mode automatically, so test-mode and live-mode destinations must both be created separately even though the URL doesn't change.

1. **`stripe-webhook`**, *"Your account"* scope — `checkout.session.completed` (legacy/platform-only checkouts, e.g. free entries or an organiser without Connect set up).
2. **`stripe-webhook`** (same URL), *"Connected accounts"* scope — `checkout.session.completed` (the normal case: Direct-charge checkouts on a connected account).
3. **`stripe-connect-webhook`**, *"Connected accounts"* scope, V2 thin events — `v2.core.account[requirements].updated`, `v2.core.account[configuration.merchant].capability_status_updated`, `v2.core.account[configuration.recipient].capability_status_updated` (keeps `stripe_charges_ready`/`stripe_payouts_ready` on `profiles`/`organisations` in sync).

`stripe-webhook`'s handler tries both `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_CHECKOUT_WEBHOOK_SECRET` when verifying a signature, since either destination can deliver to the same URL.

## Connect account IDs are per-mode

Test-mode and live-mode Stripe Connect accounts are separate namespaces — a test-mode `acct_...` doesn't exist under a live secret key. `stripe-connect-onboarding` only creates a *new* account when the owner's `stripe_account_id` is null (`supabase/functions/stripe-connect-onboarding/index.ts:58`); if a stale test-mode ID is left in place, it will try to issue a live Account Link against a nonexistent account and fail.

Before onboarding any real organiser in live mode, clear out test-mode Connect data:
```sql
update profiles set stripe_account_id = null, stripe_account_country = null,
  stripe_card_payments_status = null, stripe_charges_ready = false,
  stripe_payouts_ready = false, stripe_account_updated_at = null
where stripe_account_id is not null;

update organisations set stripe_account_id = null, stripe_account_country = null,
  stripe_card_payments_status = null, stripe_charges_ready = false,
  stripe_payouts_ready = false, stripe_account_updated_at = null
where stripe_account_id is not null;
```
Run via `supabase db query --linked` (not `db push` — see project convention). Every organiser who onboarded during test-mode internal testing will need to redo Connect onboarding once live.

## Admin dashboard: what's platform-scoped vs. connected-account-scoped

`admin-api`'s Stripe calls default to the **platform's own account**. Since real money moves through connected accounts (Direct charges), a few actions explicitly fan out per-account:

- `payments-list` looks up each entry's Checkout Session with `{ stripeAccount: <entry's stripe_account_id> }` when set (Direct-charge sessions don't exist under the platform account).
- `stripe-events` (failed payments, disputes, refunds) queries the platform account **and** every connected account with `stripe_charges_ready = true`, merging results — capped at 50 accounts (`admin-api/index.ts`, `MAX_CONNECT_ACCOUNTS_FOR_EVENTS`); revisit if the organiser count grows well past that.
- `payouts-list` and the `stripe.balance.retrieve()` calls (dashboard KPI tiles, Financial Centre, health-check) are **intentionally platform-account-only** — they show the platform's own Stripe balance/payouts to its own bank account, not what's owed to organisers. The Financial Centre UI labels this explicitly; see "Settlements" for organiser payouts instead.

## Verification checklist after a cutover

- [ ] `admin-api` `health-check` action returns green for `stripe`.
- [ ] A real organiser completes Connect onboarding end-to-end; `stripe_charges_ready` flips true.
- [ ] One real, small-value entry purchase: entry flips to `confirmed`, `stripe-webhook` fires, net amount backfills (either immediately or via the `backfill-entry-net-amount` cron).
- [ ] Admin Financial Centre (`/admin/financial`) shows a non-blank Stripe status for that payment, and the connected account's dispute/refund panel reflects reality (not just "always empty" from looking at the wrong account).
