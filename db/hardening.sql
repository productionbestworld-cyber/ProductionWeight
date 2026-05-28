-- ════════════════════════════════════════════════════════════════════
--  BWP — Production Hardening Migration
--  รันใน Supabase SQL Editor ครั้งเดียวก่อนใช้งานจริง
--
--  ครอบคลุม:
--    1) Unique partial index บน production_rolls กัน roll_no ชน
--    2) RPC delete_roll_atomic        — ลบม้วน + log ใน transaction เดียว
--    3) RPC return_to_rework_atomic   — ส่งม้วน good กลับกรอ atomic
--    4) RPC next_roll_no              — gen roll_no ฝั่ง DB (กันชน offline)
--    5) RLS: เพิกถอน DELETE ตรงจาก anon (บังคับใช้ผ่าน RPC เท่านั้น)
-- ════════════════════════════════════════════════════════════════════

-- ─── 1) Unique partial index — กัน roll_no ซ้ำใน lot เดียวกัน ─────────
-- หมายเหตุ: ถ้ามีข้อมูลเก่าซ้ำอยู่แล้ว index จะสร้างไม่สำเร็จ
-- ให้รัน query ตรวจซ้ำก่อน แล้วแก้ข้อมูลก่อน:
--   SELECT machine_no, lot_no, roll_no, roll_type, COUNT(*)
--   FROM production_rolls
--   WHERE roll_type IN ('good','bad')
--   GROUP BY 1,2,3,4 HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_production_rolls_lot_rollno
  ON production_rolls (machine_no, lot_no, roll_no, roll_type)
  WHERE roll_type IN ('good','bad') AND roll_no > 0;

-- ─── 2) RPC: delete_roll_atomic ─────────────────────────────────────
-- ลบม้วน + insert log ใน transaction เดียว
-- ถ้า log insert fail หรือ delete fail → rollback ทั้งคู่
DROP FUNCTION IF EXISTS delete_roll_atomic(BIGINT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION delete_roll_atomic(
  p_roll_id     BIGINT,
  p_deleted_by  TEXT,
  p_reason      TEXT,
  p_work_order  TEXT DEFAULT NULL,
  p_sale_order  TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_roll  production_rolls%ROWTYPE;
  v_logid BIGINT;
BEGIN
  IF p_deleted_by IS NULL OR length(trim(p_deleted_by)) = 0 THEN
    RAISE EXCEPTION 'deleted_by required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required';
  END IF;

  SELECT * INTO v_roll FROM production_rolls WHERE id = p_roll_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'roll % not found', p_roll_id;
  END IF;

  INSERT INTO roll_deletion_logs (
    deleted_by, reason, machine_no, lot_no,
    work_order, sale_order, roll_no, roll_type,
    weight, gross_weight, core_weight, length, pcs,
    product_name, product_code, item_code, mat_code,
    cust_code, cust_name, width_cm, thick_mc,
    inspector, started_at, original_id, section
  ) VALUES (
    trim(p_deleted_by), trim(p_reason), v_roll.machine_no, v_roll.lot_no,
    COALESCE(p_work_order, v_roll.work_order, ''),
    COALESCE(p_sale_order, v_roll.sale_order, ''),
    v_roll.roll_no, v_roll.roll_type,
    v_roll.weight, v_roll.gross_weight, v_roll.core_weight, v_roll.length, v_roll.pcs,
    v_roll.product_name, v_roll.product_code, v_roll.item_code, v_roll.mat_code,
    v_roll.cust_code, v_roll.customer, v_roll.width_cm, v_roll.thick_mc,
    v_roll.inspector, v_roll.created_at, v_roll.id, COALESCE(v_roll.section, 'blow')
  ) RETURNING id INTO v_logid;

  DELETE FROM production_rolls WHERE id = p_roll_id;
  RETURN v_logid;
END $$;

GRANT EXECUTE ON FUNCTION delete_roll_atomic(BIGINT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ─── 3) RPC: return_to_rework_atomic ────────────────────────────────
DROP FUNCTION IF EXISTS return_to_rework_atomic(BIGINT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION return_to_rework_atomic(
  p_roll_id      BIGINT,
  p_inbound_type TEXT,
  p_reason       TEXT,
  p_by           TEXT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_roll  production_rolls%ROWTYPE;
  v_logid BIGINT;
BEGIN
  IF p_by IS NULL OR length(trim(p_by)) = 0 THEN
    RAISE EXCEPTION 'by required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required';
  END IF;

  SELECT * INTO v_roll FROM production_rolls WHERE id = p_roll_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'roll % not found', p_roll_id;
  END IF;
  IF v_roll.roll_type <> 'good' THEN
    RAISE EXCEPTION 'roll % is not good (current=%)', p_roll_id, v_roll.roll_type;
  END IF;

  INSERT INTO roll_deletion_logs (
    deleted_by, reason, machine_no, lot_no, roll_no, roll_type,
    weight, gross_weight, core_weight, length,
    product_name, product_code, item_code, mat_code,
    cust_code, cust_name, width_cm, thick_mc,
    inspector, started_at, original_id, section
  ) VALUES (
    trim(p_by), '[ส่งกลับกรอ] ' || trim(p_reason),
    v_roll.machine_no, v_roll.lot_no, v_roll.roll_no, 'good',
    v_roll.weight, v_roll.gross_weight, v_roll.core_weight, v_roll.length,
    v_roll.product_name, v_roll.product_code, v_roll.item_code, v_roll.mat_code,
    v_roll.cust_code, v_roll.customer, v_roll.width_cm, v_roll.thick_mc,
    v_roll.inspector, v_roll.created_at, v_roll.id, 'rewind'
  ) RETURNING id INTO v_logid;

  UPDATE production_rolls SET
    roll_type        = 'bad',
    remark           = trim(p_reason),
    inbound_type     = p_inbound_type,
    rework_status    = NULL,
    transferred      = TRUE,
    transferred_by   = trim(p_by),
    transferred_at   = NOW(),
    transfer_doc_id  = NULL,
    section          = 'rewind'
  WHERE id = p_roll_id;

  RETURN v_logid;
END $$;

GRANT EXECUTE ON FUNCTION return_to_rework_atomic(BIGINT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ─── 4) RPC: next_roll_no (gap-fill, atomic) ────────────────────────
-- คืนเลขม้วนถัดไป (เติม gap ก่อน) — เรียกแทนการคำนวณฝั่ง client
DROP FUNCTION IF EXISTS next_roll_no(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION next_roll_no(
  p_machine_no TEXT,
  p_lot_no     TEXT,
  p_roll_type  TEXT          -- 'good' | 'bad'
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next INT;
BEGIN
  -- หา gap แรก โดยใช้ generate_series
  SELECT COALESCE(MIN(g), (SELECT COALESCE(MAX(roll_no),0)+1 FROM production_rolls
                            WHERE machine_no=p_machine_no AND lot_no=p_lot_no AND roll_type=p_roll_type))
  INTO v_next
  FROM generate_series(1, COALESCE((SELECT MAX(roll_no) FROM production_rolls
                                     WHERE machine_no=p_machine_no AND lot_no=p_lot_no AND roll_type=p_roll_type), 0) + 1) g
  WHERE g NOT IN (
    SELECT roll_no FROM production_rolls
    WHERE machine_no=p_machine_no AND lot_no=p_lot_no AND roll_type=p_roll_type
      AND roll_no IS NOT NULL AND roll_no > 0
  );
  RETURN COALESCE(v_next, 1);
END $$;

GRANT EXECUTE ON FUNCTION next_roll_no(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ─── 5) RLS hardening — เพิกถอน DELETE ตรงจาก anon ─────────────────
-- ม้วนทั้งหมดต้องลบผ่าน delete_roll_atomic เท่านั้น
-- (RPC เป็น SECURITY DEFINER จึง bypass RLS ได้)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='production_rolls' AND policyname='production_rolls_all') THEN
    DROP POLICY production_rolls_all ON production_rolls;
  END IF;
END $$;

ALTER TABLE production_rolls ENABLE ROW LEVEL SECURITY;

-- อ่าน + เขียน + แก้ ได้ตามปกติ (ใช้ใน WeighStation, Warehouse, Transfer, ReworkInbox)
DROP POLICY IF EXISTS "production_rolls_select" ON production_rolls;
CREATE POLICY "production_rolls_select" ON production_rolls FOR SELECT USING (true);

DROP POLICY IF EXISTS "production_rolls_insert" ON production_rolls;
CREATE POLICY "production_rolls_insert" ON production_rolls FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "production_rolls_update" ON production_rolls;
CREATE POLICY "production_rolls_update" ON production_rolls FOR UPDATE USING (true) WITH CHECK (true);

-- ❌ ไม่อนุญาตให้ DELETE ตรง — ต้องผ่าน RPC delete_roll_atomic เท่านั้น
-- (ไม่มี policy DELETE → DELETE ทุกครั้งจะ fail สำหรับ role anon)

-- ─── 6) สำรอง: View สำหรับ Export รายวัน ────────────────────────────
-- ให้ admin ดาวน์โหลด snapshot ทั้งวันได้ ป้องกันข้อมูลหาย
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

-- ─── ตรวจสอบ ────────────────────────────────────────────────────────
SELECT 'unique_idx' AS what, COUNT(*) FROM pg_indexes WHERE indexname='uniq_production_rolls_lot_rollno'
UNION ALL SELECT 'rpc_delete', COUNT(*) FROM pg_proc WHERE proname='delete_roll_atomic'
UNION ALL SELECT 'rpc_return', COUNT(*) FROM pg_proc WHERE proname='return_to_rework_atomic'
UNION ALL SELECT 'rpc_nextno', COUNT(*) FROM pg_proc WHERE proname='next_roll_no';
