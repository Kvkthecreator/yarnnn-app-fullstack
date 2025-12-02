/**
 * Context Roles Type Definitions
 *
 * Canon Reference: /docs/canon/CONTEXT_ROLES_ARCHITECTURE.md
 */

export type AnchorScope = 'core' | 'brain' | 'custom';
export type AnchorExpectedType = 'block' | 'context_item';
export type AnchorLifecycleStatus = 'missing' | 'draft' | 'approved' | 'stale' | 'archived';

/**
 * Summary of a block that fills a context role.
 */
export interface AnchorSubstrateSummary {
  id: string;
  type: AnchorExpectedType;
  title: string;
  content_snippet: string | null;
  semantic_type: string | null;
  state: string | null;
  status: string | null;
  updated_at: string | null;
  created_at: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Status summary for a context role in a basket.
 * Used by the UI to display context readiness.
 */
export interface AnchorStatusSummary {
  anchor_key: string;
  scope: AnchorScope;
  expected_type: AnchorExpectedType;
  label: string;
  required: boolean;
  description?: string | null;
  ordering?: number | null;
  lifecycle: AnchorLifecycleStatus;
  is_stale: boolean;
  linked_substrate?: AnchorSubstrateSummary | null;
  relationships: number;
  last_refreshed_at?: string | null;
  last_updated_at?: string | null;
  last_relationship_count?: number;
  registry_id: string;
  metadata: Record<string, unknown>;
}

/**
 * Refresh policy for scheduled context blocks.
 */
export interface RefreshPolicy {
  ttl_hours: number;
  source_recipe?: string;
  auto_refresh?: boolean;
}

/**
 * Context role declaration in a recipe.
 */
export interface RecipeContextRequirements {
  roles?: string[];
  roles_optional?: string[];
  substrate_blocks?: {
    min_blocks?: number;
    semantic_types?: string[];
    recency_preference?: string;
  };
  reference_assets?: {
    types?: string[];
    required?: boolean;
  };
}

/**
 * Context output declaration for context-producing recipes.
 */
export interface RecipeContextOutputs {
  role: string;
  refresh_policy?: RefreshPolicy;
}
