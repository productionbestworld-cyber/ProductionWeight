-- ─── ใบน้ำหนักแยกตามลูกค้า ────────────────────────────────────────
-- ลูกค้าแต่ละเจ้าใช้ "ใบออกน้ำหนัก" คนละแบบแนบไปกับใบส่งของ
-- ตารางนี้เก็บว่า ลูกค้าเจ้าไหน → ใช้ฟอร์มแบบไหน + ค่าคงที่ที่ต้องพิมพ์ลงหัวใบ
-- รันใน Supabase SQL Editor ครั้งเดียว

CREATE TABLE IF NOT EXISTS weight_slip_templates (
  id          BIGSERIAL PRIMARY KEY,
  cust_code   TEXT,                       -- รหัสลูกค้า (ถ้ามี) — จับคู่ก่อนชื่อ
  cust_match  TEXT NOT NULL,              -- คำในชื่อลูกค้าที่ใช้จับคู่ เช่น "หาดทิพย์"
  template    TEXT NOT NULL,              -- cok | osotspa | generic | tcp | sevenstar | haadthip
  slip_title  TEXT,                       -- ทับชื่อหัวใบ (ว่าง = ใช้ค่าเริ่มต้นของฟอร์ม)
  extra       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- ค่าคงที่: md_pct, td_pct, thick_spec, treat, material_code, std_weight, length_m, exp_months
  sort_order  INT  NOT NULL DEFAULT 100,  -- เจ้าที่เลขน้อยกว่าถูกจับคู่ก่อน (กันชื่อซ้อนกัน)
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wst_match ON weight_slip_templates(cust_match);
CREATE INDEX IF NOT EXISTS idx_wst_code  ON weight_slip_templates(cust_code);

DROP TRIGGER IF EXISTS wst_set_updated_at ON weight_slip_templates;
CREATE TRIGGER wst_set_updated_at
  BEFORE UPDATE ON weight_slip_templates
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE weight_slip_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wst_all" ON weight_slip_templates;
CREATE POLICY "wst_all" ON weight_slip_templates FOR ALL USING (true) WITH CHECK (true);

-- ค่าเริ่มต้นจากแบบฟอร์มที่ใช้จริง (แก้/เพิ่มได้ที่หน้า Admin → ใบน้ำหนักลูกค้า)
INSERT INTO weight_slip_templates (cust_match, template, extra, sort_order) VALUES
  ('ไทยน้ำทิพย์',  'cok',       '{"md_pct":"0.9","td_pct":"0.1","thick_spec":"+/-5%"}'::jsonb,        10),
  ('โอสถสภา',      'osotspa',   '{}'::jsonb,                                                         10),
  ('หาดทิพย์',     'haadthip',  '{}'::jsonb,                                                         10),
  ('เซเว่นสตาร์',  'sevenstar', '{"treat":"ไม่ระเบิดผิว"}'::jsonb,                                    10),
  ('ที.ซี.ฟาร์มา', 'tcp',       '{"exp_months":"24"}'::jsonb,                                        10),
  ('กระทิงแดง',    'tcp',       '{"exp_months":"24"}'::jsonb,                                        10)
ON CONFLICT DO NOTHING;
