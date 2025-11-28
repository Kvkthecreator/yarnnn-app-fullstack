-- Migration: Ensure grants for workspace_work_supervision_settings
-- Context: RLS is enabled; explicit grants required for authenticated/service_role

DO $$
BEGIN
  -- Grant to authenticated users (RLS still applies)
  GRANT SELECT, INSERT, UPDATE ON public.workspace_work_supervision_settings TO authenticated;

  -- Grant to service_role (bypasses RLS but needs privileges)
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_work_supervision_settings TO service_role;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'workspace_work_supervision_settings table missing; ensure base migration runs first';
END $$;
