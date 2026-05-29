-- ════════════════════════════════════════════════════════════════
--  รวมม้วนเสียจากผลิต Lot เดียวกัน = งานกรอเดียว (1 งาน / 1 Lot ต้นทาง)
--  รันใน Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════

ALTER TABLE rework_jobs ADD COLUMN IF NOT EXISTS source_lot_no    TEXT;
ALTER TABLE rework_jobs ADD COLUMN IF NOT EXISTS source_roll_count INTEGER DEFAULT 1;

-- (ทางเลือก) เติม source_lot_no ให้งานเก่าที่สร้างจากผลิต โดยดึงจากม้วนต้นทาง
UPDATE rework_jobs j
SET source_lot_no = p.lot_no
FROM production_rolls p
WHERE j.source_roll_id = p.id
  AND (j.source_lot_no IS NULL OR j.source_lot_no = '');
