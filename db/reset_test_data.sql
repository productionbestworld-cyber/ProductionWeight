-- ════════════════════════════════════════════════════════════════
--  ล้างข้อมูลธุรกรรมทั้งหมด เพื่อเริ่มเทสใหม่
--  วิธีใช้: เปิด Supabase → SQL Editor → วางทั้งไฟล์ → Run
--
--  ⚠ ลบเฉพาะ "ข้อมูลที่เกิดจากการใช้งาน" (ม้วน/งานกรอ/log/เอกสาร)
--  ✅ เก็บ master data ไว้: machine_profiles, products, customers, app_settings
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ── ม้วนผลิต + งานกรอ ──────────────────────────────────────────
TRUNCATE TABLE
  production_rolls,
  rework_jobs
RESTART IDENTITY CASCADE;

-- ── log / สรุป / เอกสาร / งานพัก ───────────────────────────────
TRUNCATE TABLE
  weigh_logs,
  roll_deletion_logs,
  job_summaries,
  parked_jobs,
  transfer_documents,
  sales_orders
RESTART IDENTITY CASCADE;

-- ── (ทางเลือก) เคลียร์ฟิลด์งานบนเครื่อง — เครื่องว่างเหมือนใหม่ ──
-- คงตัวเครื่อง + การตั้งค่า decimal/label ไว้ ลบเฉพาะข้อมูลงานปัจจุบัน
UPDATE machine_profiles SET
  cust_code = '', cust_name = '', cust_branch = '', cust_address = '',
  item_code = '', mat_code = '', product_code = '', product_name = '',
  width_cm = '', thick_mc = '',
  lot_no = '', length = '', pcs = '',
  planned_qty = '', inspector = '',
  work_order = '', sale_order = '',
  updated_at = now();

COMMIT;

-- ตรวจผล (ควรได้ 0 ทุกตาราง)
SELECT 'production_rolls' AS tbl, count(*) FROM production_rolls
UNION ALL SELECT 'rework_jobs',      count(*) FROM rework_jobs
UNION ALL SELECT 'weigh_logs',       count(*) FROM weigh_logs
UNION ALL SELECT 'transfer_documents', count(*) FROM transfer_documents
UNION ALL SELECT 'sales_orders',     count(*) FROM sales_orders;
