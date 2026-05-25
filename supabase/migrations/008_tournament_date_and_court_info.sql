-- ============================================================
-- KAN-49: Add tournament date field
-- KAN-50: Add court name and address fields
-- ============================================================

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS tournament_date  DATE,
  ADD COLUMN IF NOT EXISTS court_name       TEXT,
  ADD COLUMN IF NOT EXISTS court_address    TEXT;
