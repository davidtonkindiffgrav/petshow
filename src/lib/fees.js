// Fee math for the all-in pricing model. `settings` is the flat
// { key: numericValue } map pages build from platform_settings rows.
// Every function returns null when a required settings row is missing —
// callers must treat null as "fees not configured" and block, never default.

export function minEntryFee(currency, settings) {
  const v = settings[`min_entry_fee_${currency}`];
  return (v != null && isFinite(v)) ? v : null;
}

export function platformFee(total, currency, settings) {
  const pct   = settings['service_fee_pct'];
  const floor = settings[`service_fee_floor_${currency}`];
  if (pct == null || floor == null) return null;
  return Math.max(floor, total * pct / 100);
}

export function stripeFeeEstimate(total, currency, settings) {
  const pct   = settings['stripe_fee_pct'];
  const fixed = settings[`stripe_fee_fixed_${currency}`];
  if (pct == null || fixed == null) return null;
  return total * pct / 100 + fixed;
}

// "You receive ≈" figure shown to organisers.
export function organiserNet(total, currency, settings) {
  const pf = platformFee(total, currency, settings);
  const sf = stripeFeeEstimate(total, currency, settings);
  if (pf == null || sf == null) return null;
  return Math.max(0, total - pf - sf);
}

// Clamp an arbitrary stored fee to a whole-dollar stepper value.
export function clampFee(value, min) {
  const v = Math.round(Number(value) || 0);
  return Math.max(min, v);
}
