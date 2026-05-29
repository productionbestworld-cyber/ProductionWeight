-- ════════════════════════════════════════════════════════════════
--  แก้ "ปิดงานไม่ได้ / หน้าต่างไม่หาย" — เปิดสิทธิ์ให้ตาราง rework_jobs
--  อาการ: กดปิดงานแล้วการ์ดยังอยู่ เพราะ RLS บล็อก UPDATE เงียบ ๆ
--  รันใน Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════

-- ── ทางเลือก A (ง่ายสุด): ปิด RLS ไปเลย (เหมาะกับระบบภายในโรงงาน) ──
ALTER TABLE rework_jobs DISABLE ROW LEVEL SECURITY;

-- ── ทางเลือก B: เปิด RLS แต่อนุญาตทุก operation (ถ้าต้องการคง RLS ไว้) ──
-- ALTER TABLE rework_jobs ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS rework_jobs_all ON rework_jobs;
-- CREATE POLICY rework_jobs_all ON rework_jobs
--   FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ตรวจสอบ: ลองปิดงานทดสอบแล้วเช็คว่ามีแถวเปลี่ยน
-- SELECT id, lot_no, status, closed_at, closed_by FROM rework_jobs ORDER BY created_at DESC LIMIT 10;
