-- ════════════════════════════════════════════════════════════════════
--  แก้ type ของ column ที่เก็บ roll id ให้เป็น UUID
--  (production_rolls.id เป็น UUID — ไม่ใช่ BIGINT)
-- ════════════════════════════════════════════════════════════════════

-- 0) DROP VIEW ที่อ้างถึง column เหล่านี้ก่อน (สร้างใหม่ตอนท้าย)
DROP VIEW IF EXISTS v_production_rolls_export;

-- 1) roll_deletion_logs.original_id → UUID
ALTER TABLE roll_deletion_logs
  ALTER COLUMN original_id TYPE UUID USING NULLIF(original_id::text, '')::uuid;

-- 2) production_rolls.rework_dest_id → UUID
ALTER TABLE production_rolls
  ALTER COLUMN rework_dest_id TYPE UUID USING NULLIF(rework_dest_id::text, '')::uuid;

-- 4) สร้าง VIEW กลับขึ้นมาใหม่
CREATE OR REPLACE VIEW v_production_rolls_export AS
SELECT
  id, machine_no, lot_no, roll_no, roll_type, weight, gross_weight, core_weight,
  product_name, product_code, item_code, mat_code, customer, cust_code,
  width_cm, thick_mc, length, pcs, remark, inspector,
  section, transferred, transferred_at, transferred_by, transfer_doc_id,
  rework_status, rework_dest_id, rework_remark, inbound_type,
  created_at
FROM production_rolls
ORDER BY created_at DESC;

GRANT SELECT ON v_production_rolls_export TO anon, authenticated;

-- 3) ตรวจสอบ
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE column_name IN ('original_id', 'rework_dest_id', 'id')
  AND table_name IN ('production_rolls', 'roll_deletion_logs')
ORDER BY table_name, column_name;
