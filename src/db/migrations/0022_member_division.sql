-- The ERP division of a member: a free-text sub-group within the department
-- (the ERP's org chart columns, e.g. "Inbound" / "Outbound"). Written by the
-- org sync (src/lib/sync/erp-org.ts applyOrgHierarchy), shown on Team & access.
--
-- Not in db/schema.ts on purpose: it is read and written with raw SQL, so no
-- member query depends on it. Also self-applied at runtime by
-- erp-org.ts ensureErpOrgColumns and src/db/ensure-access.ts.

ALTER TABLE "connect"."member" ADD COLUMN IF NOT EXISTS "division" text;
