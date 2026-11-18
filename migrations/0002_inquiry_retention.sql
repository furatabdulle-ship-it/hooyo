ALTER TABLE inquiries ADD COLUMN closed_at TEXT;

UPDATE inquiries
SET closed_at = CURRENT_TIMESTAMP
WHERE status = 'closed' AND closed_at IS NULL;

CREATE INDEX IF NOT EXISTS inquiries_closed_at
  ON inquiries (status, closed_at);
