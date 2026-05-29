-- ════════════════════════════════════════════════════════════════════
--  เพิ่ม column width_unit ('cm' | 'mm') — รองรับงานที่สั่งเป็น mm
--  ค่าใน width_cm จะเก็บ "ตัวเลขตามหน่วยที่ผู้ใช้เลือก" (ไม่แปลงภายใน)
--  รันใน Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE machine_profiles ADD COLUMN IF NOT EXISTS width_unit TEXT DEFAULT 'cm';
ALTER TABLE production_rolls ADD COLUMN IF NOT EXISTS width_unit TEXT DEFAULT 'cm';
ALTER TABLE weigh_logs       ADD COLUMN IF NOT EXISTS width_unit TEXT DEFAULT 'cm';
ALTER TABLE roll_deletion_logs ADD COLUMN IF NOT EXISTS width_unit TEXT DEFAULT 'cm';

-- backfill ข้อมูลเก่าให้เป็น cm (default แล้วก็ใส่ซ้ำเผื่อ NULL)
UPDATE machine_profiles    SET width_unit = 'cm' WHERE width_unit IS NULL;
UPDATE production_rolls    SET width_unit = 'cm' WHERE width_unit IS NULL;
UPDATE weigh_logs          SET width_unit = 'cm' WHERE width_unit IS NULL;
UPDATE roll_deletion_logs  SET width_unit = 'cm' WHERE width_unit IS NULL;

-- ตรวจสอบ
SELECT 'machine_profiles' tbl, COUNT(*) FILTER (WHERE width_unit='cm') cm_count,
       COUNT(*) FILTER (WHERE width_unit='mm') mm_count FROM machine_profiles
UNION ALL SELECT 'production_rolls',
       COUNT(*) FILTER (WHERE width_unit='cm'), COUNT(*) FILTER (WHERE width_unit='mm') FROM production_rolls;
