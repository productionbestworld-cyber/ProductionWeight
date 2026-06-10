-- ย้อนกลับ machine_profiles + production_rolls ให้ตรงกับ products (หลังรัน revert-names.mjs --apply)
-- รันใน Supabase SQL editor หรือผ่าน MCP execute_sql

-- 1) machine_profiles
update machine_profiles mp
set product_name = p.product_name, product_code = p.product_code, updated_at = now()
from products p
where upper(trim(p.item_code)) = upper(trim(mp.item_code))
  and coalesce(mp.item_code,'') <> ''
  and (coalesce(mp.product_name,'') <> coalesce(p.product_name,'')
       or coalesce(mp.product_code,'') <> coalesce(p.product_code,''));

-- 2) production_rolls (เฉพาะ lot ที่เดินอยู่)
update production_rolls pr
set product_name = p.product_name, product_code = p.product_code
from machine_profiles mp, products p
where mp.machine_no = pr.machine_no and mp.lot_no = pr.lot_no
  and upper(trim(p.item_code)) = upper(trim(pr.item_code))
  and coalesce(pr.item_code,'') <> ''
  and (coalesce(pr.product_name,'') <> coalesce(p.product_name,'')
       or coalesce(pr.product_code,'') <> coalesce(p.product_code,''));
