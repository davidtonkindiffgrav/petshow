// Mirrors src/lib/fees.js's platformFee() — Deno can't import a Vite-bundled
// frontend module, so this is kept as a second copy, same as the other
// Edge Functions already do. Returns null when platform_settings config for
// this currency is missing; callers must block on null, never default.
export function platformFee(total: number, currency: string, settings: Record<string, number>): number | null {
  const pct = settings['service_fee_pct'];
  const floor = settings[`service_fee_floor_${currency}`];
  if (pct == null || floor == null) return null;
  return Math.max(floor, total * pct / 100);
}
