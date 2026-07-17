-- ── Social Promo Image Designer ──────────────────────────────────────────────

-- promo_design_json: organiser's last-used settings in the promo image
--                     designer (headline text, QR toggle), so reopening the
--                     designer restores their choices. Mirrors cert_design_json.
ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS promo_design_json jsonb;
