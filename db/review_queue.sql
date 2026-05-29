-- ════════════════════════════════════════════════════════════════════
--  Review Queue — ม้วนกรอ "รอพิจารณา" (ผลิตประเมินว่ากรอไม่ได้)
--  ผจก เข้ามาตัดสินใจว่าจะกรอจริง หรือทำอย่างอื่น
-- ════════════════════════════════════════════════════════════════════

-- review_status:
--   NULL                = ปกติ (ผลิตประเมินว่ากรอได้ → โอนได้เลย)
--   'pending_review'    = รอ ผจก พิจารณา (ยังโอนไม่ได้)
--   'approved_rework'   = ผจก อนุมัติให้กรอ
--   'other'             = ผจก ตัดสินว่าทำอย่างอื่น (เก็บไว้ / scrap / ...)
--
-- review_action: เมื่อ status='other' → 'keep' | 'scrap' (เลือกได้)
ALTER TABLE production_rolls ADD COLUMN IF NOT EXISTS review_status        TEXT;
ALTER TABLE production_rolls ADD COLUMN IF NOT EXISTS review_action        TEXT;   -- 'rework'|'keep'|'scrap'
ALTER TABLE production_rolls ADD COLUMN IF NOT EXISTS review_action_reason TEXT;
ALTER TABLE production_rolls ADD COLUMN IF NOT EXISTS review_decision_by   TEXT;
ALTER TABLE production_rolls ADD COLUMN IF NOT EXISTS review_decision_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_production_rolls_review_status
  ON production_rolls(review_status) WHERE review_status IS NOT NULL;

-- ตรวจสอบ
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='production_rolls' AND column_name LIKE 'review_%';
