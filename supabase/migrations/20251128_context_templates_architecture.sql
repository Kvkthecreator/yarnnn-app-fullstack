-- Migration: Context Templates Architecture
-- Purpose: Add context template catalog and integrate with work recipes
-- Date: 2025-11-28
-- Architecture Doc: docs/architecture/CONTEXT_TEMPLATES_ARCHITECTURE.md

-- ============================================================================
-- PHASE 1: Create context_template_catalog table
-- ============================================================================

CREATE TABLE IF NOT EXISTS context_template_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    slug TEXT NOT NULL UNIQUE,           -- "brand_identity", "competitor_registry"
    name TEXT NOT NULL,                   -- "Brand Identity"
    description TEXT,
    category TEXT DEFAULT 'foundational', -- "foundational", "research", "operational"

    -- Schema Definition (field definitions for UI rendering)
    schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Example schema:
    -- {
    --   "fields": [
    --     {"key": "name", "label": "Brand Name", "type": "text", "required": true},
    --     {"key": "tagline", "label": "Tagline", "type": "text", "required": false}
    --   ],
    --   "outputConfig": {
    --     "semantic_type": "entity",
    --     "title_template": "Brand Identity: {name}",
    --     "state": "ACCEPTED"
    --   }
    -- }

    -- Scope
    scope TEXT DEFAULT 'global' CHECK (scope IN ('global', 'workspace')),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,

    -- Metadata
    is_required BOOLEAN DEFAULT false,    -- Must be filled for basket to be "complete"?
    display_order INTEGER DEFAULT 0,
    icon TEXT,                            -- UI display icon (e.g., "building", "users")

    -- Audit
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    -- Constraints
    CONSTRAINT workspace_scope_check CHECK (
        (scope = 'global' AND workspace_id IS NULL) OR
        (scope = 'workspace' AND workspace_id IS NOT NULL)
    )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_context_template_catalog_slug ON context_template_catalog(slug);
CREATE INDEX IF NOT EXISTS idx_context_template_catalog_scope ON context_template_catalog(scope);
CREATE INDEX IF NOT EXISTS idx_context_template_catalog_workspace ON context_template_catalog(workspace_id)
    WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_context_template_catalog_category ON context_template_catalog(category);

-- Grants
GRANT ALL ON TABLE context_template_catalog TO service_role;
GRANT SELECT ON TABLE context_template_catalog TO authenticated;

-- RLS
ALTER TABLE context_template_catalog ENABLE ROW LEVEL SECURITY;

-- Global templates visible to all, workspace templates to members only
CREATE POLICY "Users can view global templates"
    ON context_template_catalog FOR SELECT
    USING (scope = 'global');

CREATE POLICY "Users can view workspace templates"
    ON context_template_catalog FOR SELECT
    USING (
        scope = 'workspace' AND
        workspace_id IN (
            SELECT workspace_id FROM workspace_memberships
            WHERE user_id = auth.uid()
        )
    );

-- ============================================================================
-- PHASE 2: Seed foundational templates
-- ============================================================================

INSERT INTO context_template_catalog (slug, name, description, category, schema, is_required, display_order, icon)
VALUES
-- Brand Identity (Required)
(
    'brand_identity',
    'Brand Identity',
    'Core brand information including name, tagline, mission, and values. This is the foundational context for all brand-related work.',
    'foundational',
    '{
        "fields": [
            {
                "key": "name",
                "label": "Brand/Company Name",
                "type": "text",
                "required": true,
                "placeholder": "Enter your brand or company name",
                "validation": {"minLength": 1, "maxLength": 100}
            },
            {
                "key": "tagline",
                "label": "Tagline",
                "type": "text",
                "required": false,
                "placeholder": "Your brand''s core message or slogan"
            },
            {
                "key": "mission",
                "label": "Mission Statement",
                "type": "textarea",
                "required": false,
                "placeholder": "What is your brand''s purpose?"
            },
            {
                "key": "values",
                "label": "Core Values",
                "type": "array",
                "itemType": "text",
                "required": false,
                "placeholder": "Add a core value",
                "minItems": 0,
                "maxItems": 10
            }
        ],
        "outputConfig": {
            "semantic_type": "entity",
            "title_template": "Brand Identity: {name}",
            "state": "ACCEPTED"
        }
    }'::jsonb,
    true,
    1,
    'building'
),

-- Competitor Registry
(
    'competitor_registry',
    'Competitor Registry',
    'List of competitors with their key information. Used by research and analysis workflows.',
    'foundational',
    '{
        "fields": [
            {
                "key": "competitors",
                "label": "Competitors",
                "type": "array",
                "itemType": "object",
                "required": true,
                "minItems": 1,
                "maxItems": 20,
                "itemSchema": {
                    "name": {"type": "text", "label": "Competitor Name", "required": true},
                    "url": {"type": "url", "label": "Website", "required": false},
                    "notes": {"type": "text", "label": "Notes", "required": false}
                }
            }
        ],
        "outputConfig": {
            "semantic_type": "entity",
            "title_template": "Competitor Registry",
            "state": "ACCEPTED"
        }
    }'::jsonb,
    false,
    2,
    'users'
),

-- Target Audience
(
    'target_audience',
    'Target Audience',
    'Definition of your target audience segments and personas. Guides content creation and messaging.',
    'foundational',
    '{
        "fields": [
            {
                "key": "segments",
                "label": "Audience Segments",
                "type": "array",
                "itemType": "object",
                "required": true,
                "minItems": 1,
                "maxItems": 10,
                "itemSchema": {
                    "name": {"type": "text", "label": "Segment Name", "required": true},
                    "description": {"type": "textarea", "label": "Description", "required": false},
                    "pain_points": {"type": "array", "itemType": "text", "label": "Pain Points", "required": false}
                }
            },
            {
                "key": "primary_persona",
                "label": "Primary Persona",
                "type": "textarea",
                "required": false,
                "placeholder": "Describe your ideal customer"
            }
        ],
        "outputConfig": {
            "semantic_type": "entity",
            "title_template": "Target Audience Definition",
            "state": "ACCEPTED"
        }
    }'::jsonb,
    false,
    3,
    'target'
),

-- Brand Voice
(
    'brand_voice',
    'Brand Voice',
    'Guidelines for brand tone, style, and communication. Ensures consistency across all content.',
    'foundational',
    '{
        "fields": [
            {
                "key": "tone",
                "label": "Tone",
                "type": "select",
                "required": true,
                "options": ["professional", "casual", "friendly", "authoritative", "playful", "inspirational"],
                "default": "professional"
            },
            {
                "key": "style_notes",
                "label": "Style Notes",
                "type": "textarea",
                "required": false,
                "placeholder": "Additional guidelines for writing style"
            },
            {
                "key": "vocabulary_use",
                "label": "Preferred Vocabulary",
                "type": "array",
                "itemType": "text",
                "required": false,
                "placeholder": "Words/phrases to use"
            },
            {
                "key": "vocabulary_avoid",
                "label": "Avoid Using",
                "type": "array",
                "itemType": "text",
                "required": false,
                "placeholder": "Words/phrases to avoid"
            }
        ],
        "outputConfig": {
            "semantic_type": "entity",
            "title_template": "Brand Voice Guidelines",
            "state": "ACCEPTED"
        }
    }'::jsonb,
    false,
    4,
    'message-circle'
),

-- Strategic Priorities
(
    'strategic_priorities',
    'Strategic Priorities',
    'Current business objectives and KPIs. Helps align agent outputs with strategic goals.',
    'foundational',
    '{
        "fields": [
            {
                "key": "objectives",
                "label": "Key Objectives",
                "type": "array",
                "itemType": "object",
                "required": true,
                "minItems": 1,
                "maxItems": 10,
                "itemSchema": {
                    "objective": {"type": "text", "label": "Objective", "required": true},
                    "timeframe": {"type": "select", "label": "Timeframe", "options": ["Q1", "Q2", "Q3", "Q4", "This Year", "Next Year"], "required": false},
                    "kpi": {"type": "text", "label": "Key Metric", "required": false}
                }
            },
            {
                "key": "current_focus",
                "label": "Current Focus Area",
                "type": "text",
                "required": false,
                "placeholder": "What''s the top priority right now?"
            }
        ],
        "outputConfig": {
            "semantic_type": "entity",
            "title_template": "Strategic Priorities",
            "state": "ACCEPTED"
        }
    }'::jsonb,
    false,
    5,
    'flag'
)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    schema = EXCLUDED.schema,
    is_required = EXCLUDED.is_required,
    display_order = EXCLUDED.display_order,
    icon = EXCLUDED.icon,
    updated_at = now();

-- ============================================================================
-- PHASE 3: Add template columns to work_recipes
-- ============================================================================

ALTER TABLE work_recipes
ADD COLUMN IF NOT EXISTS required_templates TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS recommended_templates TEXT[] DEFAULT '{}';

-- Add comments
COMMENT ON COLUMN work_recipes.required_templates IS 'Context template slugs that MUST be filled before recipe execution';
COMMENT ON COLUMN work_recipes.recommended_templates IS 'Context template slugs recommended for better results (soft requirement)';

-- ============================================================================
-- PHASE 4: Update existing recipes with template references
-- ============================================================================

-- Executive Summary Deck - requires brand identity, recommends others
UPDATE work_recipes
SET
    required_templates = ARRAY['brand_identity'],
    recommended_templates = ARRAY['strategic_priorities', 'target_audience'],
    updated_at = now()
WHERE slug = 'executive-summary-deck';

-- Research Deep Dive - requires brand identity, recommends competitor registry
UPDATE work_recipes
SET
    required_templates = ARRAY['brand_identity'],
    recommended_templates = ARRAY['competitor_registry', 'target_audience'],
    updated_at = now()
WHERE slug = 'research-deep-dive';

-- Update any content recipes
UPDATE work_recipes
SET
    required_templates = ARRAY['brand_identity'],
    recommended_templates = ARRAY['brand_voice', 'target_audience'],
    updated_at = now()
WHERE agent_type = 'content' AND required_templates = '{}';

-- ============================================================================
-- PHASE 5: Create helper functions
-- ============================================================================

-- Function: Get template status for a basket
CREATE OR REPLACE FUNCTION get_basket_template_status(p_basket_id UUID)
RETURNS TABLE (
    template_slug TEXT,
    template_name TEXT,
    is_required BOOLEAN,
    is_filled BOOLEAN,
    block_id UUID,
    filled_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ct.slug as template_slug,
        ct.name as template_name,
        ct.is_required,
        (b.id IS NOT NULL) as is_filled,
        b.id as block_id,
        b.created_at as filled_at
    FROM context_template_catalog ct
    LEFT JOIN blocks b ON
        b.basket_id = p_basket_id
        AND b.metadata->>'template_id' = ct.slug
        AND b.state IN ('ACCEPTED', 'LOCKED', 'CONSTANT')
    WHERE ct.scope = 'global'
    ORDER BY ct.display_order;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Check if basket has required templates filled
CREATE OR REPLACE FUNCTION check_basket_template_requirements(
    p_basket_id UUID,
    p_required_templates TEXT[]
)
RETURNS TABLE (
    template_slug TEXT,
    is_filled BOOLEAN,
    block_id UUID
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.slug as template_slug,
        (b.id IS NOT NULL) as is_filled,
        b.id as block_id
    FROM unnest(p_required_templates) AS req(slug)
    JOIN context_template_catalog t ON t.slug = req.slug
    LEFT JOIN blocks b ON
        b.basket_id = p_basket_id
        AND b.metadata->>'template_id' = t.slug
        AND b.state IN ('ACCEPTED', 'LOCKED', 'CONSTANT');
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Get foundational blocks for agent context assembly
CREATE OR REPLACE FUNCTION get_foundational_blocks(
    p_basket_id UUID,
    p_template_slugs TEXT[]
)
RETURNS TABLE (
    template_slug TEXT,
    block_id UUID,
    title TEXT,
    content TEXT,
    semantic_type TEXT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.metadata->>'template_id' as template_slug,
        b.id as block_id,
        b.title,
        b.content,
        b.semantic_type,
        b.created_at
    FROM blocks b
    WHERE b.basket_id = p_basket_id
        AND b.metadata->>'template_id' = ANY(p_template_slugs)
        AND b.state IN ('ACCEPTED', 'LOCKED', 'CONSTANT')
    ORDER BY
        array_position(p_template_slugs, b.metadata->>'template_id'),
        b.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grants for functions
GRANT EXECUTE ON FUNCTION get_basket_template_status TO service_role;
GRANT EXECUTE ON FUNCTION get_basket_template_status TO authenticated;
GRANT EXECUTE ON FUNCTION check_basket_template_requirements TO service_role;
GRANT EXECUTE ON FUNCTION check_basket_template_requirements TO authenticated;
GRANT EXECUTE ON FUNCTION get_foundational_blocks TO service_role;
GRANT EXECUTE ON FUNCTION get_foundational_blocks TO authenticated;

-- ============================================================================
-- PHASE 6: Verification
-- ============================================================================

DO $$
DECLARE
    template_count INTEGER;
    recipes_with_templates INTEGER;
BEGIN
    -- Count templates
    SELECT COUNT(*) INTO template_count FROM context_template_catalog;

    -- Count recipes with template references
    SELECT COUNT(*) INTO recipes_with_templates
    FROM work_recipes
    WHERE required_templates != '{}' OR recommended_templates != '{}';

    RAISE NOTICE '';
    RAISE NOTICE '✅ Context Templates Architecture Migration Complete:';
    RAISE NOTICE '   - Templates in catalog: %', template_count;
    RAISE NOTICE '   - Recipes with template refs: %', recipes_with_templates;
    RAISE NOTICE '';
    RAISE NOTICE '📋 Foundational templates:';
    RAISE NOTICE '   - brand_identity (required)';
    RAISE NOTICE '   - competitor_registry';
    RAISE NOTICE '   - target_audience';
    RAISE NOTICE '   - brand_voice';
    RAISE NOTICE '   - strategic_priorities';
    RAISE NOTICE '';
    RAISE NOTICE '🔗 Next steps:';
    RAISE NOTICE '   1. Add API endpoint: POST /api/baskets/{id}/templates/{slug}/fill';
    RAISE NOTICE '   2. Update frontend context page with template UI';
    RAISE NOTICE '   3. Enhance agent context assembly with template-aware retrieval';
END $$;
