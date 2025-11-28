-- Migration: Workspace Work Supervision Defaults
-- Scope: workspace-level settings for work supervision (separate from substrate governance)
-- Default posture: auto-approval (review_strategy = 'auto')

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'workspace_work_supervision_settings'
  ) THEN
    CREATE TABLE public.workspace_work_supervision_settings (
      workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
      review_strategy text NOT NULL DEFAULT 'auto' CHECK (review_strategy IN ('auto', 'manual')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TRIGGER trg_workspace_work_supervision_settings_updated_at
      BEFORE UPDATE ON public.workspace_work_supervision_settings
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();

    COMMENT ON TABLE public.workspace_work_supervision_settings IS 'Workspace-level defaults for work supervision (work outputs review posture)';
    COMMENT ON COLUMN public.workspace_work_supervision_settings.review_strategy IS 'auto = auto-approve work outputs by default; manual = require explicit review';
  END IF;
END $$;

-- RLS
ALTER TABLE public.workspace_work_supervision_settings ENABLE ROW LEVEL SECURITY;

-- Allow owners/admins to read/update/insert
CREATE POLICY workspace_work_supervision_settings_select ON public.workspace_work_supervision_settings
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    WHERE wm.workspace_id = workspace_work_supervision_settings.workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner','admin')
  )
);

CREATE POLICY workspace_work_supervision_settings_update ON public.workspace_work_supervision_settings
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    WHERE wm.workspace_id = workspace_work_supervision_settings.workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner','admin')
  )
);

CREATE POLICY workspace_work_supervision_settings_insert ON public.workspace_work_supervision_settings
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    WHERE wm.workspace_id = workspace_work_supervision_settings.workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner','admin')
  )
);

GRANT SELECT ON public.workspace_work_supervision_settings TO authenticated;
GRANT INSERT, UPDATE ON public.workspace_work_supervision_settings TO authenticated;
