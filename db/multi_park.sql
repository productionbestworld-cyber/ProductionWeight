-- ════════════════════════════════════════════════════════════════════
--  Multi-park — เครื่องนึงพักงานได้หลายงาน (unique key เปลี่ยนจาก
--  machine_no → (machine_no, lot_no))
-- ════════════════════════════════════════════════════════════════════

-- เพิ่ม lot_no column (แยกออกจาก profile_snapshot JSON เพื่อใช้ใน constraint)
ALTER TABLE parked_jobs ADD COLUMN IF NOT EXISTS lot_no TEXT;

-- backfill จาก snapshot เดิม
UPDATE parked_jobs SET lot_no = profile_snapshot->>'lotNo' WHERE lot_no IS NULL;

-- ลบ unique constraint เก่าบน machine_no
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.parked_jobs'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%(machine_no)%'
  LOOP
    EXECUTE 'ALTER TABLE parked_jobs DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END $$;

-- ลบ index เก่าถ้ามี
DROP INDEX IF EXISTS parked_jobs_machine_no_key;

-- เพิ่ม unique index ใหม่บน (machine_no, lot_no)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_parked_machine_lot
  ON parked_jobs (machine_no, COALESCE(lot_no, ''));

-- ตรวจสอบ
SELECT machine_no, lot_no, profile_snapshot->>'productName' AS product, parked_by, parked_at
FROM parked_jobs ORDER BY machine_no, parked_at;
