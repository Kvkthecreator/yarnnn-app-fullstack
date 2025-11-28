-- Migration: Rollback Context Templates Architecture
-- Purpose: Remove context_template_catalog and related artifacts
-- Reason: Context Templates superseded by Anchor Seeding approach
-- Decision Doc: docs/architecture/ANCHOR_SEEDING_ARCHITECTURE.md
-- Date: 2025-11-28

-- ============================================================================
-- PHASE 1: Drop helper functions
-- ============================================================================

DROP FUNCTION IF EXISTS get_foundational_blocks(UUID, TEXT[]);
DROP FUNCTION IF EXISTS check_basket_template_requirements(UUID, TEXT[]);
DROP FUNCTION IF EXISTS get_basket_template_status(UUID);

-- ============================================================================
-- PHASE 2: Remove template columns from work_recipes
-- ============================================================================

ALTER TABLE work_recipes
DROP COLUMN IF EXISTS required_templates,
DROP COLUMN IF EXISTS recommended_templates;

-- ============================================================================
-- PHASE 3: Drop context_template_catalog table
-- ============================================================================

DROP TABLE IF EXISTS context_template_catalog CASCADE;

-- ============================================================================
-- PHASE 4: Clean up any blocks with template_id metadata
-- Note: We're NOT deleting the blocks, just removing the template reference
-- The blocks themselves remain valid and useful
-- ============================================================================

UPDATE blocks
SET metadata = metadata - 'template_id' - 'template_version' - 'filled_at'
WHERE metadata ? 'template_id';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
    -- Verify table is dropped
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'context_template_catalog') THEN
        RAISE EXCEPTION 'context_template_catalog table still exists';
    END IF;

    -- Verify columns are dropped
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'work_recipes'
        AND column_name IN ('required_templates', 'recommended_templates')
    ) THEN
        RAISE EXCEPTION 'Template columns still exist on work_recipes';
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '============================================================';
    RAISE NOTICE 'Context Templates Rollback Complete';
    RAISE NOTICE '============================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Removed:';
    RAISE NOTICE '  - context_template_catalog table';
    RAISE NOTICE '  - required_templates column from work_recipes';
    RAISE NOTICE '  - recommended_templates column from work_recipes';
    RAISE NOTICE '  - Helper functions (get_basket_template_status, etc.)';
    RAISE NOTICE '';
    RAISE NOTICE 'Preserved:';
    RAISE NOTICE '  - All existing blocks (template_id metadata removed)';
    RAISE NOTICE '  - basket_anchors table (for Anchor Seeding)';
    RAISE NOTICE '  - anchor_role column on blocks';
    RAISE NOTICE '';
    RAISE NOTICE 'Next: Implement Anchor Seeding endpoint';
    RAISE NOTICE '============================================================';
END $$;
