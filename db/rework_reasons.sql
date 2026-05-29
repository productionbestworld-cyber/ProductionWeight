-- บันทึกสาเหตุของการกรอ
ALTER TABLE rework_jobs ADD COLUMN IF NOT EXISTS source_defect_reason TEXT;
ALTER TABLE rework_jobs ADD COLUMN IF NOT EXISTS rework_reason        TEXT;
ALTER TABLE rework_jobs ADD COLUMN IF NOT EXISTS rewinder_name        TEXT;
