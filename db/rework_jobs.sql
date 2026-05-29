-- ════════════════════════════════════════════════════════════════════
--  rework_jobs — งานกรอแบบ job-centric (ไม่ผูกเครื่อง)
--  Operator สร้างงานไว้ก่อน → เลือก station ตอนชั่ง → label พิมพ์ตามที่เลือก
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rework_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- งาน
  lot_no          TEXT NOT NULL,
  sale_order      TEXT,
  work_order      TEXT,
  delivery_date   DATE,
  -- สินค้า
  item_code       TEXT,
  mat_code        TEXT,
  product_code    TEXT,
  product_name    TEXT,
  width_cm        TEXT,
  width_unit      TEXT DEFAULT 'cm',
  thick_mc        TEXT,
  -- ลูกค้า
  cust_code       TEXT,
  cust_name       TEXT,
  cust_branch     TEXT,
  -- ตั้งค่าชั่ง
  core_weight     TEXT DEFAULT '1.25',
  decimal_places  INT  DEFAULT 2,
  planned_qty     TEXT,
  inspector       TEXT,
  -- ใบปะหน้า
  label_size      TEXT DEFAULT 'long',
  header_text     TEXT,
  blank_header    BOOLEAN DEFAULT FALSE,
  -- meta
  source          TEXT DEFAULT 'manual',   -- 'manual' (ตั้งเอง) | 'from_production' (จากผลิต)
  source_roll_id  UUID,                     -- ถ้า source='from_production' → ม้วน bad ต้นทาง
  status          TEXT DEFAULT 'active',    -- 'active' | 'closed'
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  closed_by       TEXT,
  closed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rework_jobs_status ON rework_jobs(status);
CREATE INDEX IF NOT EXISTS idx_rework_jobs_lot ON rework_jobs(lot_no);

ALTER TABLE rework_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rework_jobs_all" ON rework_jobs;
CREATE POLICY "rework_jobs_all" ON rework_jobs FOR ALL USING (true) WITH CHECK (true);

-- ── ตรวจสอบ ────────────────────────────────────────────────────────
SELECT 'rework_jobs' AS what, COUNT(*) FROM rework_jobs;
