import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Mirrors src/lib/fees.js — keep the two in sync. Deno can't import a
// browser ES module across the Astro/Supabase-functions boundary.
function platformFee(total: number, currency: string, settings: Record<string, number>): number | null {
  const pct = settings['service_fee_pct'];
  const floor = settings[`service_fee_floor_${currency}`];
  if (pct == null || floor == null) return null;
  return Math.max(floor, total * pct / 100);
}
function stripeFeeEstimate(total: number, currency: string, settings: Record<string, number>): number | null {
  const pct = settings['stripe_fee_pct'];
  const fixed = settings[`stripe_fee_fixed_${currency}`];
  if (pct == null || fixed == null) return null;
  return total * pct / 100 + fixed;
}

// Mirrors src/lib/storage.js's copyImage() — Deno can't import a browser ES
// module across the Astro/Supabase-functions boundary (same reasoning as
// platformFee/stripeFeeEstimate above).
async function copyStorageImage(supabase: any, oldUrl: string | null, newPath: string): Promise<string | null> {
  if (!oldUrl) return null;
  const oldPath = oldUrl.match(/\/show-assets\/(.+)/)?.[1];
  if (!oldPath) return oldUrl;
  const ext = oldPath.split('.').pop();
  const fullNewPath = `${newPath}.${ext}`;
  const { error } = await supabase.storage.from('show-assets').copy(oldPath, fullNewPath);
  if (error) return null;
  return supabase.storage.from('show-assets').getPublicUrl(fullNewPath).data.publicUrl;
}

function stripeClient(): Stripe {
  return new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-04-10' });
}

async function loadSettingsMap(supabase: any): Promise<Record<string, number>> {
  const { data } = await supabase.from('platform_settings').select('key, value');
  const map: Record<string, number> = {};
  for (const row of data || []) {
    const n = parseFloat(row.value);
    if (isFinite(n)) map[row.key] = n;
  }
  return map;
}

function sumByCurrency(rows: any[], amountField: string, currencyOf: (r: any) => string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows || []) {
    const cur = currencyOf(r) || 'AUD';
    out[cur] = (out[cur] || 0) + (Number(r[amountField]) || 0);
  }
  return out;
}

async function writeAudit(supabase: any, actorId: string, action: string, entityType: string, entityId: string | null, details: Record<string, unknown> = {}) {
  await supabase.from('audit_log').insert({ actor_id: actorId, action, entity_type: entityType, entity_id: entityId, details });
}

// Persists Resend's used-quota headers so the admin Email Monitoring page
// can read them without a synthetic probe request — GET requests to
// /domains and /emails don't carry x-resend-daily-quota/-monthly-quota,
// only real POST /emails sends do (confirmed by testing). Mirrors the copy
// in the other Resend-sending Edge Functions — keep in sync.
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

// A raw search term is interpolated into PostgREST .or() filter strings,
// where comma separates conditions and parens group them — an unescaped
// value containing either (e.g. "Smith, Jane") would corrupt the filter
// rather than search for it. Strip them; losing them from a search term is
// harmless, unlike breaking the query.
function sanitizeSearchTerm(s: string): string {
  return String(s).replace(/[,()]/g, ' ').trim();
}

// A plain 'YYYY-MM-DD' date_to from a date-picker compares as midnight UTC —
// .lte('created_at', date_to) would silently exclude almost the entire final
// day. Push it to the end of that day so "to" is inclusive.
function endOfDayIso(dateStr: string): string {
  return `${String(dateStr).slice(0, 10)}T23:59:59.999Z`;
}

// ── Dashboard Home ────────────────────────────────────────────────────────────
const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

function rangeStartFor(range: string): Date {
  const now = new Date();
  if (range === 'ytd') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const days = RANGE_DAYS[range] || 30;
  return new Date(Date.now() - (days - 1) * 86400000);
}

function dayKey(iso: string): string {
  return String(iso).slice(0, 10);
}

// Build one bucket per day between start and today (inclusive), pre-seeded at 0.
function buildDayBuckets(start: Date): Record<string, { date: string; new_users: number; new_shows: number; new_entries: number; revenue_aud: number }> {
  const buckets: Record<string, any> = {};
  const startDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const today = new Date();
  const todayDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let d = new Date(startDay); d <= todayDay; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    buckets[key] = { date: key, new_users: 0, new_shows: 0, new_entries: 0, revenue_aud: 0 };
  }
  return buckets;
}

async function getTrends(supabase: any, range: string) {
  const start = rangeStartFor(range);
  const startIso = start.toISOString();
  const buckets = buildDayBuckets(start);

  const [usersRes, showsRes, entriesRes] = await Promise.all([
    supabase.from('profiles').select('created_at').gte('created_at', startIso),
    supabase.from('shows').select('created_at').gte('created_at', startIso),
    supabase.from('show_entries').select('created_at, entry_fee_paid, status, shows(currency)').gte('created_at', startIso).eq('status', 'confirmed'),
  ]);

  for (const u of usersRes.data || []) { const k = dayKey(u.created_at); if (buckets[k]) buckets[k].new_users++; }
  for (const s of showsRes.data || []) { const k = dayKey(s.created_at); if (buckets[k]) buckets[k].new_shows++; }
  for (const e of entriesRes.data || []) {
    const k = dayKey(e.created_at);
    if (!buckets[k]) continue;
    buckets[k].new_entries++;
    // Revenue chart shows the platform's primary currency (AUD) only —
    // a small early platform mixing AUD/NZD in one line chart would be
    // misleading; NZD is still fully represented in the KPI tiles above.
    if ((e.shows?.currency || 'AUD') === 'AUD') buckets[k].revenue_aud += Number(e.entry_fee_paid) || 0;
  }

  return Object.values(buckets);
}

async function getStats(supabase: any, payload: any) {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const settings = await loadSettingsMap(supabase);

  const [entriesTodayRes, entriesMonthRes, showsRes, orgsRes, entrantsRes, accountsRes, pendingRes, paidRes, paidThisMonthRes] = await Promise.all([
    supabase.from('show_entries').select('entry_fee_paid, created_at, shows(currency)').eq('status', 'confirmed').gte('created_at', todayStart),
    supabase.from('show_entries').select('entry_fee_paid, created_at, shows(currency)').eq('status', 'confirmed').gte('created_at', monthStart),
    supabase.from('shows').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    supabase.from('organisations').select('id', { count: 'exact', head: true }),
    supabase.from('show_entries').select('id', { count: 'exact', head: true }).eq('status', 'confirmed'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('settlements').select('net_amount_owed, currency').eq('status', 'pending_approval'),
    supabase.from('settlements').select('amount_paid, currency').eq('status', 'paid'),
    // finalised_at (not the admin-editable payment_date) is the system
    // timestamp of when a settlement actually became 'paid' — matches how
    // every other "this month" figure here buckets by a real event time.
    supabase.from('settlements').select('amount_paid, currency').eq('status', 'paid').gte('finalised_at', monthStart),
  ]);

  const revenue_today = sumByCurrency(entriesTodayRes.data || [], 'entry_fee_paid', (r) => r.shows?.currency);
  const revenue_month = sumByCurrency(entriesMonthRes.data || [], 'entry_fee_paid', (r) => r.shows?.currency);

  const platform_fees_month: Record<string, number> = {};
  for (const r of entriesMonthRes.data || []) {
    const cur = r.shows?.currency || 'AUD';
    const fee = platformFee(Number(r.entry_fee_paid) || 0, cur, settings);
    if (fee != null) platform_fees_month[cur] = (platform_fees_month[cur] || 0) + fee;
  }

  const pending_payouts = {
    count: (pendingRes.data || []).length,
    by_currency: sumByCurrency(pendingRes.data || [], 'net_amount_owed', (r) => r.currency),
  };
  const completed_payouts = {
    count: (paidRes.data || []).length,
    by_currency: sumByCurrency(paidRes.data || [], 'amount_paid', (r) => r.currency),
  };
  const paid_this_month = {
    count: (paidThisMonthRes.data || []).length,
    by_currency: sumByCurrency(paidThisMonthRes.data || [], 'amount_paid', (r) => r.currency),
  };

  let stripe_balance: any = null;
  try {
    const bal = await stripeClient().balance.retrieve();
    stripe_balance = {
      available: bal.available.map((b: any) => ({ amount: b.amount / 100, currency: b.currency.toUpperCase() })),
      pending: bal.pending.map((b: any) => ({ amount: b.amount / 100, currency: b.currency.toUpperCase() })),
    };
  } catch { /* surfaced via System Health instead of failing the whole dashboard */ }

  // Recent activity — merge a few small queries, each independently safe to fail.
  const activity: { type: string; text: string; timestamp: string }[] = [];
  try {
    const { data } = await supabase.from('shows').select('id, title, created_at').order('created_at', { ascending: false }).limit(5);
    for (const s of data || []) activity.push({ type: 'show', text: `New show: ${s.title}`, timestamp: s.created_at });
  } catch { /* skip */ }
  try {
    const { data } = await supabase.from('organisations').select('id, name, created_at').order('created_at', { ascending: false }).limit(5);
    for (const o of data || []) activity.push({ type: 'organisation', text: `New organisation: ${o.name}`, timestamp: o.created_at });
  } catch { /* skip */ }
  try {
    const { data } = await supabase.from('settlements').select('id, show_id, created_at, shows(title)').eq('status', 'pending_approval').order('created_at', { ascending: false }).limit(5);
    for (const s of data || []) activity.push({ type: 'settlement', text: `Settlement pending approval: ${s.shows?.title || s.show_id}`, timestamp: s.created_at });
  } catch { /* skip */ }
  try {
    const { data } = await supabase.from('show_entries').select('id, animal_name, entry_fee_paid, created_at, shows(title, currency)').eq('status', 'confirmed').gte('entry_fee_paid', 50).order('created_at', { ascending: false }).limit(5);
    for (const e of data || []) activity.push({ type: 'payment', text: `Large payment: ${e.shows?.currency || ''} ${Number(e.entry_fee_paid).toFixed(2)} for ${e.shows?.title || 'a show'}`, timestamp: e.created_at });
  } catch { /* skip */ }
  activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const trends = await getTrends(supabase, payload?.range || '30d');

  return {
    revenue_today,
    revenue_month,
    platform_fees_month,
    pending_payouts,
    completed_payouts,
    paid_this_month,
    active_shows: showsRes.count || 0,
    active_organisations: orgsRes.count || 0,
    total_entrants: entrantsRes.count || 0,
    total_accounts: accountsRes.count || 0,
    stripe_balance,
    activity: activity.slice(0, 15),
    trends,
  };
}

// Adjust here if the overdue threshold ever needs to change — there's no
// admin UI for this yet (Platform Config is a separate, untouched section),
// so a named constant is the "easy to find and adjust" mechanism for now.
const SETTLEMENT_OVERDUE_DAYS = 14;

// Two distinct "needs action" signals for the Dashboard's alert strip:
// (1) a show whose results are published but has no settlement yet — the
// admin needs to generate one; (2) a settlement that's been sitting in
// pending_approval too long. Both are computed for alerting only — neither
// writes back to the settlement's stored `status`, so the real status/pill
// shown everywhere else stays exactly what an admin actually set it to.
async function getNeedsAttention(supabase: any) {
  const overdueThresholdIso = new Date(Date.now() - SETTLEMENT_OVERDUE_DAYS * 86400000).toISOString();

  const [showsRes, settlementsRes] = await Promise.all([
    supabase.from('shows').select('id').not('results_published_at', 'is', null),
    supabase.from('settlements').select('show_id, status, created_at, currency, net_amount_owed'),
  ]);

  // Any existing settlement row (including 'cancelled') counts as already
  // actioned — generateSettlement() already refuses to regenerate over a
  // cancelled settlement, so flagging those shows here would point at an
  // alert with nothing left to do behind it.
  const settledShowIds = new Set((settlementsRes.data || []).map((s: any) => s.show_id));
  const showsNeedingSettlementCount = (showsRes.data || []).filter((s: any) => !settledShowIds.has(s.id)).length;

  const overdue = (settlementsRes.data || []).filter(
    (s: any) => s.status === 'pending_approval' && s.created_at < overdueThresholdIso
  );

  return {
    shows_needing_settlement: { count: showsNeedingSettlementCount },
    settlements_overdue: {
      count: overdue.length,
      by_currency: sumByCurrency(overdue, 'net_amount_owed', (r: any) => r.currency),
    },
    overdue_threshold_days: SETTLEMENT_OVERDUE_DAYS,
  };
}

// ── Financial Centre ──────────────────────────────────────────────────────────
async function getFinancialSummary(supabase: any, payload: any) {
  const { show_id, organisation_id, date_from, date_to } = payload || {};

  let stripe_balance: any = null;
  try {
    const bal = await stripeClient().balance.retrieve();
    stripe_balance = {
      available: bal.available.map((b: any) => ({ amount: b.amount / 100, currency: b.currency.toUpperCase() })),
      pending: bal.pending.map((b: any) => ({ amount: b.amount / 100, currency: b.currency.toUpperCase() })),
    };
  } catch (err: any) {
    stripe_balance = { error: err.message };
  }

  let query = supabase
    .from('show_entries')
    .select('entry_fee_paid, created_at, shows!inner(currency, organisation_id)')
    .eq('status', 'confirmed');
  if (show_id) query = query.eq('show_id', show_id);
  if (organisation_id) query = query.eq('shows.organisation_id', organisation_id);
  if (date_from) query = query.gte('created_at', date_from);
  if (date_to) query = query.lte('created_at', endOfDayIso(date_to));

  const { data: entries, error } = await query;
  if (error) throw new Error('Failed to load revenue: ' + error.message);

  const settings = await loadSettingsMap(supabase);
  const gross_revenue: Record<string, number> = {};
  const platform_revenue: Record<string, number> = {};
  const stripe_processing_fees: Record<string, number> = {};
  for (const e of entries || []) {
    const cur = e.shows?.currency || 'AUD';
    const total = Number(e.entry_fee_paid) || 0;
    gross_revenue[cur] = (gross_revenue[cur] || 0) + total;
    const pf = platformFee(total, cur, settings);
    const sf = stripeFeeEstimate(total, cur, settings);
    platform_revenue[cur] = (platform_revenue[cur] || 0) + (pf ?? 0);
    stripe_processing_fees[cur] = (stripe_processing_fees[cur] || 0) + (sf ?? 0);
  }
  const net_paid_to_organisers: Record<string, number> = {};
  for (const cur of Object.keys(gross_revenue)) {
    net_paid_to_organisers[cur] = gross_revenue[cur] - (platform_revenue[cur] || 0) - (stripe_processing_fees[cur] || 0);
  }

  return { stripe_balance, gross_revenue, platform_revenue, stripe_processing_fees, net_paid_to_organisers };
}

async function getPayments(supabase: any, stripe: Stripe, payload: any) {
  const { show_id, organisation_id, status, date_from, date_to, page = 1, page_size = 25 } = payload || {};

  let query = supabase
    .from('show_entries')
    .select('id, animal_name, exhibitor_name, exhibitor_email, entry_fee_paid, status, stripe_session_id, created_at, shows!inner(id, title, currency, organisation_id)', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (show_id) query = query.eq('show_id', show_id);
  if (organisation_id) query = query.eq('shows.organisation_id', organisation_id);
  if (status) query = query.eq('status', status);
  if (date_from) query = query.gte('created_at', date_from);
  if (date_to) query = query.lte('created_at', endOfDayIso(date_to));

  const from = (page - 1) * page_size;
  const to = from + page_size - 1;
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) throw new Error('Failed to load payments: ' + error.message);

  // Enrich only the current page with a light Stripe status lookup —
  // avoids bulk-listing/reconciling all Stripe sessions for every request.
  const enriched = await Promise.all((data || []).map(async (row: any) => {
    let stripe_status: string | null = null;
    if (row.stripe_session_id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(row.stripe_session_id);
        stripe_status = session.payment_status;
      } catch { /* session may not exist (test cleanup, mode mismatch) */ }
    }
    return { ...row, stripe_status };
  }));

  return { rows: enriched, total: count || 0, page, page_size };
}

async function getPayouts(stripe: Stripe, payload: any) {
  const { limit = 25, starting_after } = payload || {};
  const list = await stripe.payouts.list({ limit, ...(starting_after ? { starting_after } : {}) });
  return {
    rows: list.data.map((p: any) => ({
      id: p.id,
      amount: p.amount / 100,
      currency: p.currency.toUpperCase(),
      status: p.status,
      arrival_date: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString() : null,
      created: new Date(p.created * 1000).toISOString(),
    })),
    has_more: list.has_more,
  };
}

async function getStripeEvents(stripe: Stripe, payload: any) {
  const { limit = 25 } = payload || {};
  const [intents, disputes, refunds] = await Promise.all([
    stripe.paymentIntents.list({ limit }),
    stripe.disputes.list({ limit }),
    stripe.refunds.list({ limit }),
  ]);
  const failed_payments = intents.data
    .filter((pi: any) => pi.last_payment_error || pi.status === 'requires_payment_method')
    .map((pi: any) => ({
      id: pi.id,
      amount: pi.amount / 100,
      currency: pi.currency.toUpperCase(),
      last_error: pi.last_payment_error?.message || null,
      created: new Date(pi.created * 1000).toISOString(),
    }));

  return {
    failed_payments,
    disputes: disputes.data.map((d: any) => ({
      id: d.id, amount: d.amount / 100, currency: d.currency.toUpperCase(),
      status: d.status, reason: d.reason, created: new Date(d.created * 1000).toISOString(),
    })),
    refunds: refunds.data.map((r: any) => ({
      id: r.id, amount: r.amount / 100, currency: r.currency.toUpperCase(),
      status: r.status, created: new Date(r.created * 1000).toISOString(),
    })),
  };
}

// ── Settlement Management ─────────────────────────────────────────────────────
async function generateSettlement(supabase: any, payload: any, actorId: string) {
  const { show_id } = payload || {};
  if (!show_id) throw new Error('Missing show_id');

  const { data: show, error: showErr } = await supabase
    .from('shows')
    .select('id, title, currency, organisation_id')
    .eq('id', show_id)
    .single();
  if (showErr || !show) throw new Error('Show not found');

  const { data: existing } = await supabase
    .from('settlements')
    .select('id, status')
    .eq('show_id', show_id)
    .maybeSingle();
  if (existing?.status === 'paid') throw new Error('This settlement is already paid — record an adjustment instead of regenerating.');
  if (existing?.status === 'cancelled') throw new Error('This settlement was cancelled — a new one cannot be auto-generated over it.');

  const settings = await loadSettingsMap(supabase);
  const { data: entries, error: entriesErr } = await supabase
    .from('show_entries')
    .select('id, entry_fee_paid, stripe_session_id')
    .eq('show_id', show_id)
    .eq('status', 'confirmed');
  if (entriesErr) throw new Error('Failed to load entries: ' + entriesErr.message);

  const currency = show.currency;
  let gross = 0, platformFeeSum = 0, stripeFeeSum = 0;
  for (const e of entries || []) {
    const total = Number(e.entry_fee_paid) || 0;
    gross += total;
    platformFeeSum += platformFee(total, currency, settings) ?? 0;
    stripeFeeSum += stripeFeeEstimate(total, currency, settings) ?? 0;
  }

  // Refunds — summed live from Stripe by this show's checkout sessions
  // (refunds are inherently Stripe-sourced truth, not duplicated locally).
  let refunds = 0;
  const sessionIds = [...new Set((entries || []).map((e: any) => e.stripe_session_id).filter(Boolean))] as string[];
  const stripe = stripeClient();
  for (const sid of sessionIds) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sid);
      if (session.payment_intent) {
        const refundList = await stripe.refunds.list({ payment_intent: session.payment_intent as string, limit: 10 });
        for (const r of refundList.data) refunds += r.amount / 100;
      }
    } catch { /* session may be unavailable (test data, mode mismatch) — skip */ }
  }

  const netOwed = Math.max(0, gross - platformFeeSum - stripeFeeSum - refunds);
  const row = {
    show_id,
    organisation_id: show.organisation_id,
    currency,
    gross_entry_fees: gross,
    platform_fee: platformFeeSum,
    stripe_fees: stripeFeeSum,
    refunds,
    net_amount_owed: netOwed,
    entry_count: (entries || []).length,
    generated_by: actorId,
  };

  let settlementId: string;
  if (existing) {
    const { data: updated, error: updErr } = await supabase.from('settlements').update(row).eq('id', existing.id).select('id').single();
    if (updErr) throw new Error('Failed to update settlement: ' + updErr.message);
    settlementId = updated.id;
  } else {
    const { data: inserted, error: insErr } = await supabase.from('settlements').insert({ ...row, status: 'draft' }).select('id').single();
    if (insErr) throw new Error('Failed to create settlement: ' + insErr.message);
    settlementId = inserted.id;
  }

  await writeAudit(supabase, actorId, 'settlement.generated', 'settlement', settlementId, { show_id, gross, net_amount_owed: netOwed });
  return { settlement_id: settlementId };
}

async function buildSettlementPdf(supabase: any, payload: any) {
  const { settlement_id } = payload || {};
  if (!settlement_id) throw new Error('Missing settlement_id');

  const { data: s, error } = await supabase
    .from('settlements')
    .select('*, shows(title, host_org, charity_number)')
    .eq('id', settlement_id)
    .single();
  if (error || !s) throw new Error('Settlement not found');

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width: W } = page.getSize();
  let y = page.getHeight() - 60;

  page.drawText('Settlement Statement', { x: 40, y, size: 20, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 30;
  page.drawText(s.shows?.title || 'Show', { x: 40, y, size: 13, font: bold });
  y -= 18;
  if (s.shows?.host_org) { page.drawText(`Organisation: ${s.shows.host_org}`, { x: 40, y, size: 10, font }); y -= 14; }
  if (s.shows?.charity_number) { page.drawText(`Charity/Non-profit ID: ${s.shows.charity_number}`, { x: 40, y, size: 10, font }); y -= 14; }
  page.drawText(`Settlement ID: ${s.id}`, { x: 40, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) }); y -= 12;
  page.drawText(`Generated: ${new Date(s.created_at).toLocaleDateString()}`, { x: 40, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) }); y -= 30;

  const money = (n: number) => `${s.currency} ${Number(n).toFixed(2)}`;
  const line = (label: string, value: string, isBold = false) => {
    page.drawText(label, { x: 40, y, size: 11, font: isBold ? bold : font });
    page.drawText(value, { x: W - 160, y, size: 11, font: isBold ? bold : font });
    y -= 20;
  };

  line('Gross entry fees', money(s.gross_entry_fees));
  line('Platform fee (estimated)', `-${money(s.platform_fee)}`);
  line('Stripe processing fees (estimated)', `-${money(s.stripe_fees)}`);
  line('Refunds', `-${money(s.refunds)}`);
  y -= 6;
  page.drawLine({ start: { x: 40, y: y + 14 }, end: { x: W - 40, y: y + 14 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  line('Net amount owed to organiser', money(s.net_amount_owed), true);
  line('Amount paid to date', money(s.amount_paid));
  line('Status', String(s.status).replace('_', ' ').toUpperCase(), true);

  y -= 20;
  page.drawText('Fee figures are estimated from platform settings applied per entry, not a sum of', { x: 40, y, size: 8, font, color: rgb(0.5, 0.5, 0.5) }); y -= 10;
  page.drawText('individually captured Stripe transaction fees.', { x: 40, y, size: 8, font, color: rgb(0.5, 0.5, 0.5) });

  const pdfBytes = await doc.save();
  const path = `settlements/${s.show_id}/${s.id}.pdf`;
  const { error: upErr } = await supabase.storage.from('show-assets').upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw new Error('Failed to upload PDF: ' + upErr.message);

  const { data: { publicUrl } } = supabase.storage.from('show-assets').getPublicUrl(path);
  await supabase.from('settlements').update({ pdf_url: publicUrl }).eq('id', settlement_id);

  return { pdf_url: publicUrl };
}

async function sendSettlementEmail(supabase: any, payload: any, actorId: string) {
  const { settlement_id } = payload || {};
  if (!settlement_id) throw new Error('Missing settlement_id');

  const { data: s, error } = await supabase
    .from('settlements')
    .select('*, shows(title, contact_email)')
    .eq('id', settlement_id)
    .single();
  if (error || !s) throw new Error('Settlement not found');
  if (!s.pdf_url) throw new Error('Generate the PDF before emailing the statement');
  if (!s.shows?.contact_email) throw new Error('This show has no contact email on file');

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) throw new Error('RESEND_API_KEY secret is not set');
  const fromAddr = Deno.env.get('RESEND_FROM') || 'Fur to Feathers <noreply@furtofeathers.com>';

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify({
      from: fromAddr,
      to: [s.shows.contact_email],
      subject: `Settlement Statement — ${s.shows.title}`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1c1626">
          <p>Hi,</p>
          <p>Attached is the settlement statement for <strong>${s.shows.title}</strong>.</p>
          <p style="margin:24px 0"><a href="${s.pdf_url}" style="display:inline-block;padding:10px 20px;background:#1ba89a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Download Statement</a></p>
          <p style="font-size:12px;color:#9BB4AF">Fur to Feathers</p>
        </div>
      `,
    }),
  });
  await persistResendQuota(supabase, emailRes);
  if (!emailRes.ok) throw new Error(`Resend API error ${emailRes.status}: ${await emailRes.text()}`);

  await writeAudit(supabase, actorId, 'settlement.emailed', 'settlement', settlement_id, { to: s.shows.contact_email });
  return { success: true };
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending_approval', 'cancelled'],
  pending_approval: ['paid', 'cancelled', 'draft'],
  paid: [],
  cancelled: [],
  overdue: ['paid', 'cancelled'],
};

async function updateSettlementStatus(supabase: any, payload: any, actorId: string) {
  const { settlement_id, new_status, note, adjustment_amount, adjustment_reason, amount_paid, payment_date } = payload || {};
  if (!settlement_id || !new_status) throw new Error('Missing settlement_id or new_status');

  const { data: s, error } = await supabase.from('settlements').select('id, status').eq('id', settlement_id).single();
  if (error || !s) throw new Error('Settlement not found');

  // Post-paid correction path — never mutate the paid figures directly;
  // the DB trigger backs this up even if this check has a bug.
  if (s.status === 'paid' && new_status === 'paid') {
    if (adjustment_amount == null || !adjustment_reason) throw new Error('This settlement is paid — provide adjustment_amount and adjustment_reason');
    const { data: adj, error: adjErr } = await supabase
      .from('settlement_adjustments')
      .insert({ settlement_id, amount: adjustment_amount, reason: adjustment_reason, created_by: actorId })
      .select('id')
      .single();
    if (adjErr) throw new Error('Failed to record adjustment: ' + adjErr.message);
    await writeAudit(supabase, actorId, 'settlement.adjusted', 'settlement', settlement_id, { amount: adjustment_amount, reason: adjustment_reason });
    return { adjustment_id: adj.id };
  }

  if (!VALID_TRANSITIONS[s.status]?.includes(new_status)) {
    throw new Error(`Cannot move a settlement from '${s.status}' to '${new_status}'`);
  }

  const update: Record<string, unknown> = { status: new_status };
  if (note != null) update.notes = note;
  if (new_status === 'paid') {
    update.finalised_at = new Date().toISOString();
    update.paid_by = actorId;
    if (amount_paid != null) update.amount_paid = amount_paid;
    if (payment_date != null) update.payment_date = payment_date;
  }

  const { error: updErr } = await supabase.from('settlements').update(update).eq('id', settlement_id);
  if (updErr) throw new Error('Failed to update status: ' + updErr.message);

  await writeAudit(supabase, actorId, 'settlement.status_changed', 'settlement', settlement_id, { from: s.status, to: new_status });
  return { success: true };
}

// Shows/organisations have no admin RLS bypass policy (only settlements/
// settlement_adjustments/audit_log do) — admin pages must never rely on
// direct client-side supabase.from('shows')/('organisations') queries, since
// those tables' existing RLS is scoped to each organiser's own rows. This
// action gives the UI a service-role-backed list for filter dropdowns and
// the "Generate Settlement" picker.
async function getFilterOptions(supabase: any) {
  const [showsRes, orgsRes] = await Promise.all([
    supabase.from('shows').select('id, title, status, currency, organisation_id, host_org, charity_number, contact_email, suspended_at, featured').order('title'),
    supabase.from('organisations').select('id, name, notes').order('name'),
  ]);
  return { shows: showsRes.data || [], organisations: orgsRes.data || [] };
}

// ── User Management ───────────────────────────────────────────────────────────
async function getUsersList(supabase: any, payload: any) {
  const { search, role, suspended, page = 1, page_size = 25 } = payload || {};
  let query = supabase
    .from('profiles')
    .select('id, display_name, first_name, last_name, roles, organisation_id, suspended_at, created_at', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (search) {
    const s = `%${sanitizeSearchTerm(search)}%`;
    query = query.or(`display_name.ilike.${s},first_name.ilike.${s},last_name.ilike.${s}`);
  }
  if (role) query = query.contains('roles', [role]);
  if (suspended === 'suspended') query = query.not('suspended_at', 'is', null);
  if (suspended === 'active') query = query.is('suspended_at', null);

  const from = (page - 1) * page_size;
  const to = from + page_size - 1;
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) throw new Error('Failed to load users: ' + error.message);

  // Enrich only the current page with email — auth.admin.getUserById is a
  // service-role-only capability; listUsers() paginates independently of
  // profiles and would be awkward to keep in sync with this search/filter.
  const enriched = await Promise.all((data || []).map(async (row: any) => {
    let email: string | null = null;
    try {
      const { data: userRes } = await supabase.auth.admin.getUserById(row.id);
      email = userRes?.user?.email || null;
    } catch { /* auth user may be missing */ }
    return { ...row, email };
  }));

  return { rows: enriched, total: count || 0, page, page_size };
}

async function getUserDetail(supabase: any, payload: any) {
  const { user_id } = payload || {};
  if (!user_id) throw new Error('Missing user_id');

  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user_id).single();
  if (error || !profile) throw new Error('User not found');

  let email: string | null = null;
  let last_sign_in_at: string | null = null;
  try {
    const { data: userRes } = await supabase.auth.admin.getUserById(user_id);
    email = userRes?.user?.email || null;
    last_sign_in_at = userRes?.user?.last_sign_in_at || null;
  } catch { /* skip */ }

  // show_entries has no user_id column, only exhibitor_email — the closest
  // identity link that exists today. Known gap: entries made under a
  // different email than the account's login email won't show up here.
  const [organisedRes, enteredRes] = await Promise.all([
    supabase.from('shows').select('id, title, status, show_date, currency').eq('created_by', user_id).order('created_at', { ascending: false }),
    email
      ? supabase.from('show_entries').select('id, animal_name, status, entry_fee_paid, created_at, shows(id, title, currency)').eq('exhibitor_email', email).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
  ]);

  return {
    profile,
    email,
    last_sign_in_at,
    shows_organised: organisedRes.data || [],
    shows_entered: enteredRes.data || [],
  };
}

async function suspendUser(supabase: any, payload: any, actorId: string) {
  const { user_id, reason } = payload || {};
  if (!user_id) throw new Error('Missing user_id');
  if (user_id === actorId) throw new Error('Cannot suspend your own account');

  const { data: target } = await supabase.from('profiles').select('roles').eq('id', user_id).single();
  if (!target) throw new Error('User not found');
  if (target.roles?.includes('admin')) throw new Error('Cannot suspend an admin account');

  const { error } = await supabase.from('profiles').update({
    suspended_at: new Date().toISOString(),
    suspended_reason: reason || null,
    suspended_by: actorId,
  }).eq('id', user_id);
  if (error) throw new Error('Failed to suspend user: ' + error.message);

  await writeAudit(supabase, actorId, 'user.suspended', 'profile', user_id, { reason });
  return { success: true };
}

async function unsuspendUser(supabase: any, payload: any, actorId: string) {
  const { user_id } = payload || {};
  if (!user_id) throw new Error('Missing user_id');

  const { error } = await supabase.from('profiles')
    .update({ suspended_at: null, suspended_reason: null, suspended_by: null })
    .eq('id', user_id);
  if (error) throw new Error('Failed to unsuspend user: ' + error.message);

  await writeAudit(supabase, actorId, 'user.unsuspended', 'profile', user_id, {});
  return { success: true };
}

async function updateUserProfile(supabase: any, payload: any, actorId: string) {
  const { user_id, first_name, last_name, display_name } = payload || {};
  if (!user_id) throw new Error('Missing user_id');

  const update: Record<string, unknown> = {};
  if (first_name !== undefined) update.first_name = first_name || null;
  if (last_name !== undefined) update.last_name = last_name || null;
  if (display_name !== undefined) update.display_name = display_name || null;
  if (!Object.keys(update).length) return { success: true };

  const { error } = await supabase.from('profiles').update(update).eq('id', user_id);
  if (error) throw new Error('Failed to update profile: ' + error.message);

  await writeAudit(supabase, actorId, 'user.profile_updated', 'profile', user_id, update);
  return { success: true };
}

const VALID_ROLES = ['participant', 'organiser', 'judge', 'admin'];

async function updateUserRoles(supabase: any, payload: any, actorId: string) {
  const { user_id, roles } = payload || {};
  if (!user_id) throw new Error('Missing user_id');
  if (!Array.isArray(roles) || !roles.length) throw new Error('A user must have at least one role');
  for (const r of roles) {
    if (!VALID_ROLES.includes(r)) throw new Error(`Unknown role: ${r}`);
  }

  const { data: target, error: fetchErr } = await supabase.from('profiles').select('roles').eq('id', user_id).single();
  if (fetchErr || !target) throw new Error('User not found');

  // Prevent an admin locking themselves out by removing their own admin role.
  // Demoting/promoting OTHER admins is allowed — role editing is the
  // intended mechanism for managing who has admin access.
  if (user_id === actorId && target.roles?.includes('admin') && !roles.includes('admin')) {
    throw new Error('Cannot remove your own admin role');
  }

  const { error } = await supabase.from('profiles').update({ roles }).eq('id', user_id);
  if (error) throw new Error('Failed to update roles: ' + error.message);

  await writeAudit(supabase, actorId, 'user.roles_changed', 'profile', user_id, { from: target.roles, to: roles });
  return { success: true };
}

// ── Show Management ────────────────────────────────────────────────────────────
async function getShowsList(supabase: any, payload: any) {
  const { search, status, organisation_id, date_from, date_to, page = 1, page_size = 25 } = payload || {};
  let query = supabase
    .from('shows')
    .select('id, title, status, currency, organisation_id, host_org, show_date, suspended_at, featured, created_at', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (search) query = query.ilike('title', `%${search}%`);
  if (status) query = query.eq('status', status);
  if (organisation_id) query = query.eq('organisation_id', organisation_id);
  if (date_from) query = query.gte('created_at', date_from);
  if (date_to) query = query.lte('created_at', endOfDayIso(date_to));

  const from = (page - 1) * page_size;
  const to = from + page_size - 1;
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) throw new Error('Failed to load shows: ' + error.message);

  // Enrich only the current page with entry count + revenue — same pattern
  // as the Stripe status lookups in getPayments.
  const enriched = await Promise.all((data || []).map(async (show: any) => {
    const { data: entries } = await supabase.from('show_entries').select('entry_fee_paid').eq('show_id', show.id).eq('status', 'confirmed');
    const entry_count = entries?.length || 0;
    const revenue = (entries || []).reduce((s: number, e: any) => s + (Number(e.entry_fee_paid) || 0), 0);
    return { ...show, entry_count, revenue };
  }));

  return { rows: enriched, total: count || 0, page, page_size };
}

async function getShowDetail(supabase: any, payload: any) {
  const { show_id } = payload || {};
  if (!show_id) throw new Error('Missing show_id');

  const { data: show, error } = await supabase.from('shows').select('*').eq('id', show_id).single();
  if (error || !show) throw new Error('Show not found');

  const [entriesRes, judgingRes, organiserProfileRes] = await Promise.all([
    supabase.from('show_entries').select('entry_fee_paid').eq('show_id', show_id).eq('status', 'confirmed'),
    supabase.from('judge_scores').select('id', { count: 'exact', head: true }).eq('show_id', show_id),
    supabase.from('profiles').select('id, display_name').eq('id', show.created_by).maybeSingle(),
  ]);

  const entry_count = entriesRes.data?.length || 0;
  const revenue = (entriesRes.data || []).reduce((s: number, e: any) => s + (Number(e.entry_fee_paid) || 0), 0);

  let organiserEmail: string | null = null;
  try {
    const { data: userRes } = await supabase.auth.admin.getUserById(show.created_by);
    organiserEmail = userRes?.user?.email || null;
  } catch { /* skip */ }

  return {
    show,
    entry_count,
    revenue,
    // judge_scores existing and keyed by show_id is a cheap, honest "judging
    // has started" signal — not attempting to re-derive "judging complete",
    // that logic lives in organiser/judging.astro and isn't worth duplicating.
    judging_started: (judgingRes.count || 0) > 0,
    organiser: { id: show.created_by, display_name: organiserProfileRes.data?.display_name || null, email: organiserEmail },
  };
}

const SHOW_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['published', 'cancelled'],
  published: ['cancelled'],
  // No un-cancel by design — cancellation is a deliberate one-way action;
  // create a new show (or duplicate) instead. Keeps refund/settlement
  // reconciliation unambiguous.
  cancelled: [],
};

async function updateShowAdminFields(supabase: any, payload: any, actorId: string) {
  const { show_id, status, suspended, featured, admin_notes } = payload || {};
  if (!show_id) throw new Error('Missing show_id');

  const { data: show, error } = await supabase.from('shows').select('status, suspended_at').eq('id', show_id).single();
  if (error || !show) throw new Error('Show not found');

  if (status != null && status !== show.status) {
    if (!SHOW_STATUS_TRANSITIONS[show.status]?.includes(status)) {
      throw new Error(`Cannot move a show from '${show.status}' to '${status}'`);
    }
    const { error: updErr } = await supabase.from('shows').update({ status }).eq('id', show_id);
    if (updErr) throw new Error('Failed to update status: ' + updErr.message);
    await writeAudit(supabase, actorId, 'show.status_changed', 'show', show_id, { from: show.status, to: status });
  }

  if (suspended != null) {
    const value = suspended ? new Date().toISOString() : null;
    const { error: updErr } = await supabase.from('shows').update({ suspended_at: value }).eq('id', show_id);
    if (updErr) throw new Error('Failed to update suspension: ' + updErr.message);
    await writeAudit(supabase, actorId, suspended ? 'show.suspended' : 'show.unsuspended', 'show', show_id, {});
  }

  if (featured != null) {
    const { error: updErr } = await supabase.from('shows').update({ featured }).eq('id', show_id);
    if (updErr) throw new Error('Failed to update featured flag: ' + updErr.message);
    await writeAudit(supabase, actorId, 'show.featured_changed', 'show', show_id, { featured });
  }

  if (admin_notes != null) {
    const { error: updErr } = await supabase.from('shows').update({ admin_notes }).eq('id', show_id);
    if (updErr) throw new Error('Failed to update notes: ' + updErr.message);
    await writeAudit(supabase, actorId, 'show.notes_updated', 'show', show_id, {});
  }

  return { success: true };
}

async function duplicateShow(supabase: any, payload: any, actorId: string) {
  const { show_id } = payload || {};
  if (!show_id) throw new Error('Missing show_id');

  const { data: source, error } = await supabase.from('shows').select('*').eq('id', show_id).single();
  if (error || !source) throw new Error('Show not found');

  const clone: Record<string, unknown> = { ...source };
  delete clone.id;
  delete clone.created_at;
  clone.title = `${source.title} (Copy)`;
  clone.status = 'draft';
  clone.results_published_at = null;
  clone.entry_open_date = null;
  clone.entry_close_date = null;
  clone.show_date = null;
  clone.suspended_at = null;
  clone.featured = false;
  clone.admin_notes = null;
  clone.archived_at = null;
  // wizard_step is intentionally left as copied from the source (not reset
  // to a guessed "complete" value) — the source show already reflects a
  // fully-configured show, so its wizard_step is already the right value
  // to let the organiser resume editing immediately.

  const { data: inserted, error: insErr } = await supabase.from('shows').insert(clone).select('id').single();
  if (insErr) throw new Error('Failed to duplicate show: ' + insErr.message);
  const newId = inserted.id;

  // Clone structural/template content only — categories, sponsors, awards.
  // Explicitly NOT show_entries/show_judges/judge_scores/judge_rankings,
  // which are per-run data (same split already implied by the delete-cascade
  // in organiser/shows.astro). show_prizes is legacy (superseded by awards)
  // and no longer cloned — no UI writes new rows to it anymore.
  const [catsRes, sponsorsRes] = await Promise.all([
    supabase.from('show_categories').select('name, description, award_id, has_certificate').eq('show_id', show_id),
    supabase.from('show_sponsors').select('id, name, website, logo_url').eq('show_id', show_id),
  ]);

  // Sponsors clone first (capturing an old->new id map) — a cloned award's
  // sponsor_id must point at the new show's sponsor row, not the source's.
  const sponsorIdMap = new Map<string, string>();
  if (sponsorsRes.data?.length) {
    for (const s of sponsorsRes.data) {
      const { data: newSponsor } = await supabase.from('show_sponsors')
        .insert({ show_id: newId, name: s.name, website: s.website, logo_url: s.logo_url }).select('id').single();
      if (newSponsor) sponsorIdMap.set(s.id, newSponsor.id);
    }
  }

  const { data: sourceAwards } = await supabase.from('awards').select('*').eq('show_id', show_id);
  const awardIdMap = new Map<string, string>();
  if (sourceAwards?.length) {
    for (const a of sourceAwards) {
      const { data: newAward } = await supabase.from('awards').insert({
        show_id: newId, name: a.name, physical_description: a.physical_description,
        sponsor_id: a.sponsor_id ? (sponsorIdMap.get(a.sponsor_id) ?? null) : null,
      }).select('id').single();
      if (newAward) {
        awardIdMap.set(a.id, newAward.id);
        const newImageUrl = await copyStorageImage(supabase, a.image_url, `awards/${newId}/${newAward.id}`);
        if (newImageUrl) await supabase.from('awards').update({ image_url: newImageUrl }).eq('id', newAward.id);
      }
    }
  }

  if (catsRes.data?.length) {
    await supabase.from('show_categories').insert(catsRes.data.map((c: any) => ({
      show_id: newId, name: c.name, description: c.description,
      award_id: c.award_id ? (awardIdMap.get(c.award_id) ?? null) : null,
      has_certificate: !!c.has_certificate,
    })));
  }

  await writeAudit(supabase, actorId, 'show.duplicated', 'show', newId, { source_show_id: show_id });
  return { show_id: newId };
}

// ── Organisation Financial History ───────────────────────────────────────────
async function getOrganisationDetail(supabase: any, payload: any) {
  const { organisation_id } = payload || {};
  if (!organisation_id) throw new Error('Missing organisation_id');

  const { data: org, error } = await supabase.from('organisations').select('*').eq('id', organisation_id).single();
  if (error || !org) throw new Error('Organisation not found');

  const [showsRes, settlementsRes, summary] = await Promise.all([
    supabase.from('shows').select('id, title, status, show_date, currency').eq('organisation_id', organisation_id).order('created_at', { ascending: false }),
    supabase.from('settlements').select('*').eq('organisation_id', organisation_id).order('created_at', { ascending: false }),
    getFinancialSummary(supabase, { organisation_id }),
  ]);

  const settlements = settlementsRes.data || [];
  const total_paid_out: Record<string, number> = {};
  const pending_payouts: Record<string, number> = {};
  for (const s of settlements) {
    if (s.status === 'paid') total_paid_out[s.currency] = (total_paid_out[s.currency] || 0) + Number(s.amount_paid);
    if (s.status === 'pending_approval') pending_payouts[s.currency] = (pending_payouts[s.currency] || 0) + Number(s.net_amount_owed);
  }

  return {
    organisation: org,
    shows: showsRes.data || [],
    settlements,
    total_paid_out,
    pending_payouts,
    financial_summary: summary,
  };
}

async function updateOrganisationNotes(supabase: any, payload: any, actorId: string) {
  const { organisation_id, notes } = payload || {};
  if (!organisation_id) throw new Error('Missing organisation_id');

  const { error } = await supabase.from('organisations').update({ notes }).eq('id', organisation_id);
  if (error) throw new Error('Failed to update notes: ' + error.message);

  // Log that the note changed, not its content — same restraint as
  // settlement status changes, which log {from,to} rather than free text.
  await writeAudit(supabase, actorId, 'organisation.notes_updated', 'organisation', organisation_id, {});
  return { success: true };
}

// ── Global Search ──────────────────────────────────────────────────────────────
async function globalSearch(supabase: any, payload: any) {
  const q = String(payload?.q || '').trim();
  if (q.length < 2) return { users: [], shows: [], organisations: [], payments: [] };
  const like = `%${sanitizeSearchTerm(q)}%`;

  const [usersRes, showsRes, orgsRes, entriesRes] = await Promise.all([
    supabase.from('profiles').select('id, display_name, first_name, last_name, roles')
      .or(`display_name.ilike.${like},first_name.ilike.${like},last_name.ilike.${like}`).limit(8),
    supabase.from('shows').select('id, title, status, organisation_id').ilike('title', like).limit(8),
    supabase.from('organisations').select('id, name').ilike('name', like).limit(8),
    supabase.from('show_entries').select('id, animal_name, exhibitor_name, show_id, shows(title)')
      .or(`animal_name.ilike.${like},exhibitor_name.ilike.${like}`).limit(8),
  ]);

  return {
    users: usersRes.data || [],
    shows: showsRes.data || [],
    organisations: orgsRes.data || [],
    payments: entriesRes.data || [],
  };
}

// ── Platform Configuration ────────────────────────────────────────────────────
async function getPlatformSettingsList(supabase: any) {
  const { data, error } = await supabase.from('platform_settings').select('key, value').order('key');
  if (error) throw new Error('Failed to load settings: ' + error.message);
  return { rows: data || [] };
}

async function updatePlatformSetting(supabase: any, payload: any, actorId: string) {
  const { key, value } = payload || {};
  if (!key) throw new Error('Missing key');

  const { error } = await supabase.from('platform_settings').upsert({ key, value: String(value ?? '') }, { onConflict: 'key' });
  if (error) throw new Error('Failed to update setting: ' + error.message);

  await writeAudit(supabase, actorId, 'platform_setting.updated', 'platform_setting', null, { key, value });
  return { success: true };
}

// ── System Health ──────────────────────────────────────────────────────────────
async function runHealthCheck(supabase: any, stripe: Stripe) {
  const probe = async (fn: () => Promise<void>) => {
    const start = Date.now();
    try {
      await fn();
      return { status: 'green', latency_ms: Date.now() - start };
    } catch (err: any) {
      return { status: 'red', latency_ms: Date.now() - start, error: err.message };
    }
  };

  const resendProbe = async () => {
    const start = Date.now();
    try {
      const resendKey = Deno.env.get('RESEND_API_KEY');
      if (!resendKey) throw new Error('RESEND_API_KEY not set');
      const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${resendKey}` } });
      if (res.ok) return { status: 'green', latency_ms: Date.now() - start };
      return { status: 'amber', latency_ms: Date.now() - start, error: `HTTP ${res.status}` };
    } catch (err: any) {
      return { status: 'red', latency_ms: Date.now() - start, error: err.message };
    }
  };

  const [database, stripeStatus, storage, resend] = await Promise.all([
    probe(async () => { const { error } = await supabase.from('platform_settings').select('key').limit(1); if (error) throw error; }),
    probe(async () => { await stripe.balance.retrieve(); }),
    probe(async () => { const { error } = await supabase.storage.from('show-assets').list('', { limit: 1 }); if (error) throw error; }),
    resendProbe(),
  ]);

  return { database, stripe: stripeStatus, storage, resend, checked_at: new Date().toISOString() };
}

// ── Storage Monitoring ───────────────────────────────────────────────────────────
const KNOWN_PREFIXES = ['shows', 'sponsors', 'judges', 'profiles', 'entries', 'certs', 'settlements'];
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv']);

function classifyFile(name: string, mimetype?: string): 'images' | 'videos' | 'other' {
  if (mimetype?.startsWith('image/')) return 'images';
  if (mimetype?.startsWith('video/')) return 'videos';
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (IMAGE_EXT.has(ext)) return 'images';
  if (VIDEO_EXT.has(ext)) return 'videos';
  return 'other';
}

// Recursively walks a storage prefix, paginating 100 objects at a time.
// Supabase Storage's list() returns folders as entries with id === null —
// that's the only signal to distinguish a pseudo-folder from a real object.
// O(number of files) — fine at current scale, but revisit (e.g. caching, or
// only re-walking prefixes that changed) if file counts grow into the tens
// of thousands and this starts approaching the Edge Function's time budget.
async function walkBucket(supabase: any, prefix: string): Promise<{ name: string; size: number; mimetype?: string }[]> {
  const out: { name: string; size: number; mimetype?: string }[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const { data, error } = await supabase.storage.from('show-assets').list(prefix, { limit, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Failed to list ${prefix}: ${error.message}`);
    if (!data?.length) break;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        out.push(...await walkBucket(supabase, path));
      } else {
        out.push({ name: item.name, size: item.metadata?.size || 0, mimetype: item.metadata?.mimetype });
      }
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return out;
}

async function getStorageUsage(supabase: any) {
  const [dbSizeRes, showsCount, entriesCount, profilesCount, orgsCount, settlementsCount] = await Promise.all([
    supabase.rpc('admin_db_size'),
    supabase.from('shows').select('id', { count: 'exact', head: true }),
    supabase.from('show_entries').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('organisations').select('id', { count: 'exact', head: true }),
    supabase.from('settlements').select('id', { count: 'exact', head: true }),
  ]);
  if (dbSizeRes.error) throw new Error('Failed to read DB size: ' + dbSizeRes.error.message);

  const by_prefix: Record<string, number> = {};
  const breakdown: Record<string, { count: number; bytes: number }> = {
    images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 }, other: { count: 0, bytes: 0 },
  };
  let total_bytes = 0, total_files = 0;

  for (const prefix of KNOWN_PREFIXES) {
    const files = await walkBucket(supabase, prefix);
    let prefixBytes = 0;
    for (const f of files) {
      prefixBytes += f.size;
      const kind = classifyFile(f.name, f.mimetype);
      breakdown[kind].count++;
      breakdown[kind].bytes += f.size;
    }
    by_prefix[prefix] = prefixBytes;
    total_bytes += prefixBytes;
    total_files += files.length;
  }

  return {
    db_size_bytes: Number(dbSizeRes.data) || 0,
    db_size_limit_bytes: 500 * 1024 * 1024,
    storage_bytes: total_bytes,
    storage_limit_bytes: 1024 * 1024 * 1024,
    storage_file_count: total_files,
    storage_breakdown: breakdown,
    storage_by_prefix: by_prefix,
    row_counts: {
      shows: showsCount.count || 0,
      show_entries: entriesCount.count || 0,
      profiles: profilesCount.count || 0,
      organisations: orgsCount.count || 0,
      settlements: settlementsCount.count || 0,
    },
    // "Total accounts" is the closest proxy this platform has for Supabase's
    // Monthly Active Users limit — it is NOT literally the same metric (an
    // account created once and never signing in again still counts here),
    // just the best signal available without a Management API token.
    auth_users: { count: profilesCount.count || 0, limit: 50000 },
    computed_at: new Date().toISOString(),
  };
}

// ── Email Monitoring ─────────────────────────────────────────────────────────────
// Quota headers (x-resend-daily-quota/-monthly-quota) turned out to only be
// attached to real POST /emails send responses, not GET requests — confirmed
// by testing both /domains and GET /emails directly, neither carried the
// header. So there's no synthetic probe that can read "current quota" on
// demand; instead every Resend-sending function (send-certificate,
// send-vote-magic-link, invite-judges, sendSettlementEmail above) captures
// the header off its own real send and persists it to platform_settings via
// persistResendQuota(). This action just reads the last-observed values back.
async function getEmailUsage(supabase: any) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) throw new Error('RESEND_API_KEY secret is not set');

  const { data: settingsRows } = await supabase
    .from('platform_settings')
    .select('key, value')
    .in('key', ['resend_daily_quota_used', 'resend_monthly_quota_used', 'resend_quota_checked_at']);
  const settings: Record<string, string> = Object.fromEntries((settingsRows || []).map((r: any) => [r.key, r.value]));

  const daily_quota_used = settings.resend_daily_quota_used != null ? Number(settings.resend_daily_quota_used) : null;
  const monthly_quota_used = settings.resend_monthly_quota_used != null ? Number(settings.resend_monthly_quota_used) : null;
  const quota_observed_at = settings.resend_quota_checked_at || null;

  // Recent-sample delivery/bounce rate — NOT a true historical rate, no
  // local log of every email ever sent exists. This sample is the best
  // available signal, and unlike quota this IS readable via a live GET.
  let recent_sample: any = null;
  try {
    const res = await fetch('https://api.resend.com/emails?limit=100', { headers: { Authorization: `Bearer ${resendKey}` } });
    if (res.ok) {
      const body = await res.json();
      const rows = body.data || [];
      const tally: Record<string, number> = {};
      for (const r of rows) tally[r.last_event || 'unknown'] = (tally[r.last_event || 'unknown'] || 0) + 1;
      const total = rows.length;
      const delivered = tally['delivered'] || 0;
      const bounced = tally['bounced'] || 0;
      recent_sample = {
        total, tally,
        delivery_rate_pct: total ? (delivered / total) * 100 : null,
        bounce_rate_pct: total ? (bounced / total) * 100 : null,
      };
    }
  } catch { /* leave null — surfaced by System Health already */ }

  return {
    daily_quota_used, daily_quota_limit: 100,
    monthly_quota_used, monthly_quota_limit: 3000,
    quota_observed_at,
    recent_sample,
    checked_at: new Date().toISOString(),
  };
}

// ── Analytics ────────────────────────────────────────────────────────────────────
function rankMap(map: Record<string, number>, labeler: (k: string) => string, limit: number) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => ({ label: labeler(k), value: v }));
}

async function getAnalyticsLeaderboards(supabase: any, payload: any) {
  const limit = payload?.limit || 10;

  const [entriesRes, showsRes, orgsRes, catsRes] = await Promise.all([
    supabase.from('show_entries')
      .select('entry_fee_paid, breed, category_id, exhibitor_email, show_id, shows(id, title, organisation_id, currency, is_fundraising, fundraising_goal)')
      .eq('status', 'confirmed'),
    supabase.from('shows').select('id, organisation_id'),
    supabase.from('organisations').select('id, name'),
    // Mirrors organiser/entries.astro's id->name map pattern — category_id is
    // not embedded via PostgREST here, resolved the same way the rest of the
    // codebase already does it.
    supabase.from('show_categories').select('id, name'),
  ]);
  const entries = entriesRes.data || [];
  const orgMap: Record<string, string> = Object.fromEntries((orgsRes.data || []).map((o: any) => [o.id, o.name]));
  const catMap: Record<string, string> = Object.fromEntries((catsRes.data || []).map((c: any) => [c.id, c.name]));

  // Revenue figures are grouped per-currency, never blended — merging AUD
  // and NZD into one number/ranking would misrepresent magnitude. A
  // currency with no activity simply produces an empty array; the caller
  // renders no card for it rather than an empty placeholder.
  const revByOrg: Record<string, Record<string, number>> = {};
  const revByShow: Record<string, Record<string, number>> = {};
  const countByShow: Record<string, number> = {};
  const countByBreed: Record<string, number> = {};
  const countByCategory: Record<string, number> = {};
  const countByEmail: Record<string, number> = {};
  const showTitleById: Record<string, string> = {};
  const showCurrencyById: Record<string, string> = {};
  const showGoalById: Record<string, number | null> = {};
  const fundraisingShowIds = new Set<string>();

  for (const e of entries) {
    const cur = e.shows?.currency || 'AUD';
    const fee = Number(e.entry_fee_paid) || 0;
    const orgId = e.shows?.organisation_id;
    if (orgId) {
      revByOrg[cur] = revByOrg[cur] || {};
      revByOrg[cur][orgId] = (revByOrg[cur][orgId] || 0) + fee;
    }
    revByShow[cur] = revByShow[cur] || {};
    revByShow[cur][e.show_id] = (revByShow[cur][e.show_id] || 0) + fee;
    countByShow[e.show_id] = (countByShow[e.show_id] || 0) + 1;
    if (e.breed) countByBreed[e.breed] = (countByBreed[e.breed] || 0) + 1;
    if (e.category_id) countByCategory[e.category_id] = (countByCategory[e.category_id] || 0) + 1;
    if (e.exhibitor_email) countByEmail[e.exhibitor_email] = (countByEmail[e.exhibitor_email] || 0) + 1;
    if (e.shows) {
      showTitleById[e.show_id] = e.shows.title;
      showCurrencyById[e.show_id] = cur;
      showGoalById[e.show_id] = e.shows.fundraising_goal ?? null;
      if (e.shows.is_fundraising) fundraisingShowIds.add(e.show_id);
    }
  }

  const top_organisations_by_currency: Record<string, { label: string; value: number }[]> = {};
  for (const cur of Object.keys(revByOrg)) {
    top_organisations_by_currency[cur] = rankMap(revByOrg[cur], id => orgMap[id] || id, limit);
  }

  const top_fundraising_by_currency: Record<string, { label: string; value: number; goal: number | null }[]> = {};
  for (const cur of Object.keys(revByShow)) {
    const rows = Object.entries(revByShow[cur])
      .filter(([showId]) => fundraisingShowIds.has(showId))
      .map(([showId, value]) => ({ label: showTitleById[showId] || showId, value, goal: showGoalById[showId] ?? null }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
    if (rows.length) top_fundraising_by_currency[cur] = rows;
  }

  const average_entry_fee_by_currency: Record<string, number> = {};
  for (const cur of Object.keys(revByShow)) {
    const total = Object.values(revByShow[cur]).reduce((s, v) => s + v, 0);
    const count = entries.filter((e: any) => (e.shows?.currency || 'AUD') === cur).length;
    average_entry_fee_by_currency[cur] = count ? total / count : 0;
  }

  // Returning organisations: >1 show, across ALL shows (not just ones with
  // confirmed entries) — organisations, unlike revenue, aren't currency-specific.
  const showsByOrg: Record<string, number> = {};
  for (const s of showsRes.data || []) if (s.organisation_id) showsByOrg[s.organisation_id] = (showsByOrg[s.organisation_id] || 0) + 1;
  const returning_organisations = Object.entries(showsByOrg)
    .filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([id, c]) => ({ label: orgMap[id] || id, value: c }));

  const returning_entrants = Object.entries(countByEmail)
    .filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([email, c]) => ({ label: email, value: c }));

  return {
    top_organisations_by_currency,
    largest_shows: rankMap(countByShow, id => showTitleById[id] || id, limit),
    top_fundraising_by_currency,
    most_popular_categories: rankMap(countByCategory, id => catMap[id] || 'Unknown category', limit),
    // breed is free-text (autocomplete-assisted, not a constrained enum) —
    // this ranking will include typos/"Mixed"/blanks alongside real breeds.
    most_popular_breeds: rankMap(countByBreed, b => b, limit),
    returning_organisations,
    // exhibitor_email is the closest identity link show_entries has (no
    // user_id column) — same known gap as user-detail in Phase 2.
    returning_entrants,
    average_entry_fee_by_currency,
    average_entries_per_show: Object.keys(countByShow).length ? entries.length / Object.keys(countByShow).length : 0,
  };
}

// ── Documents ────────────────────────────────────────────────────────────────────
// Settlements are NOT covered by this action — the settlements table already
// has an admin RLS-bypass policy from Phase 1, so the Documents page queries
// it directly client-side, same as settlements.astro already does. This
// covers only certificates, since show_entries has no such bypass.
async function getDocumentsList(supabase: any, payload: any) {
  const { page = 1, page_size = 25 } = payload || {};
  const from = (page - 1) * page_size;
  const to = from + page_size - 1;

  const { data, count, error } = await supabase
    .from('show_entries')
    .select('id, animal_name, exhibitor_name, exhibitor_email, cert_pdf_url, cert_jpg_url, cert_email_sent_at, show_id, shows(title)', { count: 'exact' })
    .not('cert_pdf_url', 'is', null)
    .order('cert_email_sent_at', { ascending: false })
    .range(from, to);
  if (error) throw new Error('Failed to load certificates: ' + error.message);

  return { rows: data || [], total: count || 0, page, page_size };
}

// ── Router ────────────────────────────────────────────────────────────────────
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

    // 2. Server-side admin check — the actual gate. Never trust the client.
    const { data: profile } = await supabase.from('profiles').select('roles').eq('id', user.id).single();
    if (!profile?.roles?.includes('admin')) throw new Error('Forbidden: admin role required');

    // 3. Route
    const { action, payload } = await req.json();
    let result: unknown;

    switch (action) {
      case 'stats':
        result = await getStats(supabase, payload);
        break;
      case 'financial-summary':
        result = await getFinancialSummary(supabase, payload);
        break;
      case 'payments-list':
        result = await getPayments(supabase, stripeClient(), payload);
        break;
      case 'payouts-list':
        result = await getPayouts(stripeClient(), payload);
        break;
      case 'stripe-events':
        result = await getStripeEvents(stripeClient(), payload);
        break;
      case 'generate-settlement':
        result = await generateSettlement(supabase, payload, user.id);
        break;
      case 'settlement-pdf':
        result = await buildSettlementPdf(supabase, payload);
        break;
      case 'send-settlement-email':
        result = await sendSettlementEmail(supabase, payload, user.id);
        break;
      case 'update-settlement-status':
        result = await updateSettlementStatus(supabase, payload, user.id);
        break;
      case 'health-check':
        result = await runHealthCheck(supabase, stripeClient());
        break;
      case 'filter-options':
        result = await getFilterOptions(supabase);
        break;
      case 'users-list':
        result = await getUsersList(supabase, payload);
        break;
      case 'user-detail':
        result = await getUserDetail(supabase, payload);
        break;
      case 'suspend-user':
        result = await suspendUser(supabase, payload, user.id);
        break;
      case 'unsuspend-user':
        result = await unsuspendUser(supabase, payload, user.id);
        break;
      case 'update-user-profile':
        result = await updateUserProfile(supabase, payload, user.id);
        break;
      case 'update-user-roles':
        result = await updateUserRoles(supabase, payload, user.id);
        break;
      case 'shows-list':
        result = await getShowsList(supabase, payload);
        break;
      case 'show-detail':
        result = await getShowDetail(supabase, payload);
        break;
      case 'update-show-admin-fields':
        result = await updateShowAdminFields(supabase, payload, user.id);
        break;
      case 'duplicate-show':
        result = await duplicateShow(supabase, payload, user.id);
        break;
      case 'organisation-detail':
        result = await getOrganisationDetail(supabase, payload);
        break;
      case 'update-organisation-notes':
        result = await updateOrganisationNotes(supabase, payload, user.id);
        break;
      case 'global-search':
        result = await globalSearch(supabase, payload);
        break;
      case 'platform-settings-list':
        result = await getPlatformSettingsList(supabase);
        break;
      case 'update-platform-setting':
        result = await updatePlatformSetting(supabase, payload, user.id);
        break;
      case 'storage-usage':
        result = await getStorageUsage(supabase);
        break;
      case 'email-usage':
        result = await getEmailUsage(supabase);
        break;
      case 'analytics-leaderboards':
        result = await getAnalyticsLeaderboards(supabase, payload);
        break;
      case 'documents-list':
        result = await getDocumentsList(supabase, payload);
        break;
      case 'needs-attention':
        result = await getNeedsAttention(supabase);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
