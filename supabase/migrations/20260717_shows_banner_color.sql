-- ── Show Banner Theme Color ───────────────────────────────────────────────────

-- banner_color: hex accent color extracted from the banner image on upload
--               (client-side canvas sampling), used to theme the public show
--               page hero/CTA. Organisers can override the auto-detected value.
ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS banner_color text;
