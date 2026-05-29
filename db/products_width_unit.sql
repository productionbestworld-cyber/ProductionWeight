-- เพิ่ม width_unit ใน products master (บางงานสั่งเป็น mm)
ALTER TABLE products ADD COLUMN IF NOT EXISTS width_unit TEXT DEFAULT 'cm';
UPDATE products SET width_unit = 'cm' WHERE width_unit IS NULL;
