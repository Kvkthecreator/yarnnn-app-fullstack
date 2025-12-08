-- Migration: Add 'reference' context schema for user-shared information
-- Date: 2025-12-08
-- Purpose: Enable TP to store user-shared information as bulk working context
--
-- This adds a flexible 'reference' schema for:
-- - User-shared data (financial reports, market data, research)
-- - Bulk inputs before categorization
-- - Any working context that doesn't fit structured schemas
--
-- Design rationale:
-- - Working tier (not ephemeral) because user data should persist
-- - Non-singleton (multiple references allowed with item_key)
-- - Minimal schema (title, description, tags, data) for flexibility

BEGIN;

-- Add 'reference' schema to context_entry_schemas
INSERT INTO context_entry_schemas (
    anchor_role,
    display_name,
    description,
    icon,
    category,
    is_singleton,
    sort_order,
    field_schema
)
VALUES (
    'reference',
    'Reference',
    'User-shared information, data, or research materials',
    'FileText',
    'market',  -- Maps to 'working' tier
    false,     -- Multiple references allowed (non-singleton)
    15,        -- Between market (10) and insight (20)
    '{
        "fields": [
            {"key": "title", "type": "text", "label": "Title", "required": true, "placeholder": "Brief title for this reference"},
            {"key": "description", "type": "longtext", "label": "Description", "placeholder": "What is this reference about?"},
            {"key": "data", "type": "longtext", "label": "Data", "placeholder": "The actual content or data"},
            {"key": "source", "type": "text", "label": "Source", "placeholder": "Where did this come from?"},
            {"key": "tags", "type": "array", "label": "Tags", "item_type": "text", "placeholder": "Add tags for categorization"}
        ],
        "flexible": true,
        "allow_extra_fields": true
    }'::jsonb
)
ON CONFLICT (anchor_role) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    category = EXCLUDED.category,
    is_singleton = EXCLUDED.is_singleton,
    field_schema = EXCLUDED.field_schema,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

-- Verification
DO $$
DECLARE
    schema_exists BOOLEAN;
    schema_category TEXT;
    schema_singleton BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM context_entry_schemas WHERE anchor_role = 'reference'
    ) INTO schema_exists;

    SELECT category, is_singleton INTO schema_category, schema_singleton
    FROM context_entry_schemas WHERE anchor_role = 'reference';

    RAISE NOTICE '';
    RAISE NOTICE '============================================================';
    RAISE NOTICE 'Migration: Add reference context schema (20251208)';
    RAISE NOTICE '============================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Schema added: %', CASE WHEN schema_exists THEN 'YES' ELSE 'NO' END;
    RAISE NOTICE 'Category: % (maps to working tier)', schema_category;
    RAISE NOTICE 'Singleton: % (multiple references allowed)', schema_singleton;
    RAISE NOTICE '';
    RAISE NOTICE 'Use case: Store user-shared data as working context';
    RAISE NOTICE 'Example: write_context(item_type="reference", item_key="korean_fin_2024", ...)';
    RAISE NOTICE '============================================================';
END $$;

COMMIT;
