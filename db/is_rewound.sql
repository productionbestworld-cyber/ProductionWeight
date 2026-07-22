-- ม้วนกรอที่เอากลับมาชั่งที่ "เครื่องผลิตที่เดินอยู่" (เลข/Lot ต่อเนื่อง ลูกค้าเห็นเป็นม้วนใหม่)
-- is_rewound = true → ม้วนนี้จริงๆ มาจากงานกรอ (แม้ section='blow')
--   • แดชบอร์ด: ตัดออกจาก "FG ครั้งแรก" (กันนับซ้ำ) แต่ยังนับเป็นผลงานกรอ
--   • ที่มา/เศษกรอ ยึด rework_source_roll_id + rework_source_weight เหมือนเดิม
ALTER TABLE production_rolls ADD COLUMN IF NOT EXISTS is_rewound BOOLEAN DEFAULT false;
ALTER TABLE weigh_logs       ADD COLUMN IF NOT EXISTS is_rewound BOOLEAN DEFAULT false;
