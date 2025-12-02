/**
 * Context Roles Registry
 *
 * Provides functions for querying blocks with context roles (anchor_role).
 * Context roles indicate strategic significance of blocks within a basket.
 *
 * Canon Reference: /docs/canon/CONTEXT_ROLES_ARCHITECTURE.md
 *
 * Foundation roles: problem, customer, vision, solution, feature, constraint, metric, insight
 * Insight roles: trend_digest, competitor_snapshot, market_signal, brand_voice, strategic_direction, customer_insight
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { AnchorStatusSummary, AnchorExpectedType, AnchorScope } from './types';

const MAX_ANCHOR_STALE_DAYS = 21;
const APPROVED_BLOCK_STATES = new Set(['ACCEPTED', 'LOCKED', 'CONSTANT']);

/**
 * Foundation roles that every project should ideally have.
 */
export const FOUNDATION_ROLES = ['problem', 'customer', 'vision'] as const;

/**
 * All valid context roles.
 */
export const ALL_CONTEXT_ROLES = [
  // Foundation
  'problem', 'customer', 'solution', 'feature',
  'constraint', 'metric', 'insight', 'vision',
  // Insight (agent-producible, refreshable)
  'trend_digest', 'competitor_snapshot', 'market_signal',
  'brand_voice', 'strategic_direction', 'customer_insight',
] as const;

export type ContextRole = typeof ALL_CONTEXT_ROLES[number];

function computeIsStale(updatedAt?: string | null, ttlHours?: number | null): boolean {
  if (!updatedAt) return true;
  const updatedTs = new Date(updatedAt).getTime();
  if (Number.isNaN(updatedTs)) return true;

  // Use TTL from refresh_policy if available, otherwise default
  const staleDays = ttlHours ? ttlHours / 24 : MAX_ANCHOR_STALE_DAYS;
  const staleThreshold = Date.now() - staleDays * 24 * 60 * 60 * 1000;
  return updatedTs < staleThreshold;
}

function anchorScopeOrder(scope: AnchorScope): number {
  switch (scope) {
    case 'core':
      return 0;
    case 'brain':
      return 1;
    default:
      return 2;
  }
}

function summariseContent(body?: string | null, content?: string | null): string | null {
  const source = body ?? content ?? null;
  if (!source) return null;
  const trimmed = source.replace(/\s+/g, ' ').trim();
  if (!trimmed.length) return null;
  if (trimmed.length <= 280) return trimmed;
  return `${trimmed.slice(0, 277)}…`;
}

interface BlockWithRole {
  id: string;
  basket_id: string;
  title: string | null;
  body_md: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
  semantic_type: string | null;
  state: string | null;
  status: string | null;
  updated_at: string | null;
  created_at: string | null;
  anchor_role: string;
  anchor_status: string | null;
  anchor_confidence: number | null;
  refresh_policy: { ttl_hours?: number; source_recipe?: string; auto_refresh?: boolean } | null;
}

/**
 * Load all blocks with context roles from a basket.
 */
async function loadContextRoleBlocks(
  supabase: SupabaseClient,
  basketId: string
): Promise<BlockWithRole[]> {
  const { data, error } = await supabase
    .from('blocks')
    .select('id, basket_id, title, body_md, content, metadata, semantic_type, state, status, updated_at, created_at, anchor_role, anchor_status, anchor_confidence, refresh_policy')
    .eq('basket_id', basketId)
    .not('anchor_role', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load context role blocks: ${error.message}`);
  }

  return (data || []) as BlockWithRole[];
}

/**
 * Build relationship count map for given block IDs.
 */
async function buildRelationshipCounts(
  supabase: SupabaseClient,
  basketId: string,
  blockIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (blockIds.length === 0) return counts;

  const [fromRes, toRes] = await Promise.all([
    supabase
      .from('substrate_relationships')
      .select('from_id')
      .eq('basket_id', basketId)
      .in('from_id', blockIds),
    supabase
      .from('substrate_relationships')
      .select('to_id')
      .eq('basket_id', basketId)
      .in('to_id', blockIds),
  ]);

  if (fromRes.error) {
    throw new Error(`Failed to load relationship counts: ${fromRes.error.message}`);
  }
  if (toRes.error) {
    throw new Error(`Failed to load relationship counts: ${toRes.error.message}`);
  }

  for (const row of fromRes.data ?? []) {
    const id = row.from_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const row of toRes.data ?? []) {
    const id = row.to_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return counts;
}

/**
 * Derive lifecycle status from block state and staleness.
 */
function deriveLifecycle(
  block: BlockWithRole
): { lifecycle: AnchorStatusSummary['lifecycle']; isStale: boolean } {
  const state = (block.state ?? '').toUpperCase();

  // Check if approved state
  if (!APPROVED_BLOCK_STATES.has(state)) {
    return { lifecycle: 'draft', isStale: false };
  }

  // Check staleness using refresh_policy TTL if available
  const ttlHours = block.refresh_policy?.ttl_hours;
  const stale = computeIsStale(block.updated_at, ttlHours);

  return {
    lifecycle: stale ? 'stale' : 'approved',
    isStale: stale,
  };
}

/**
 * List all context roles with their status for a basket.
 *
 * This is the main function used by the UI to show context readiness.
 */
export async function listAnchorsWithStatus(
  supabase: SupabaseClient,
  basketId: string
): Promise<AnchorStatusSummary[]> {
  // Verify basket exists
  const { data: basketRow, error: basketError } = await supabase
    .from('baskets')
    .select('id')
    .eq('id', basketId)
    .maybeSingle();

  if (basketError || !basketRow) {
    throw new Error(`Basket not found: ${basketError?.message || basketId}`);
  }

  // Load blocks with context roles
  const blocks = await loadContextRoleBlocks(supabase, basketId);
  const blockIds = blocks.map(b => b.id);

  // Get relationship counts
  const relationshipCounts = await buildRelationshipCounts(supabase, basketId, blockIds);

  // Transform to AnchorStatusSummary format
  const summaries: AnchorStatusSummary[] = blocks.map((block, index) => {
    const { lifecycle, isStale } = deriveLifecycle(block);

    return {
      anchor_key: block.anchor_role,
      scope: 'core' as AnchorScope, // All roles treated as core for now
      expected_type: 'block' as AnchorExpectedType,
      label: block.title || block.anchor_role,
      required: false, // Roles are advisory, not required
      description: null,
      ordering: index,
      lifecycle,
      is_stale: isStale,
      linked_substrate: {
        id: block.id,
        type: 'block' as AnchorExpectedType,
        title: block.title || block.anchor_role,
        content_snippet: summariseContent(block.body_md, block.content),
        semantic_type: block.semantic_type,
        state: block.state,
        status: block.status,
        updated_at: block.updated_at,
        created_at: block.created_at,
        metadata: block.metadata,
      },
      relationships: relationshipCounts.get(block.id) ?? 0,
      last_refreshed_at: block.updated_at,
      last_updated_at: block.updated_at,
      last_relationship_count: relationshipCounts.get(block.id) ?? 0,
      registry_id: block.id,
      metadata: block.metadata ?? {},
    };
  });

  // Sort by scope, then ordering, then label
  return summaries.sort((a, b) => {
    const scopeOrder = anchorScopeOrder(a.scope) - anchorScopeOrder(b.scope);
    if (scopeOrder !== 0) return scopeOrder;
    const orderingA = a.ordering ?? 0;
    const orderingB = b.ordering ?? 0;
    if (orderingA !== orderingB) return orderingA - orderingB;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Check if a basket has all required foundation roles.
 */
export async function checkFoundationRolesComplete(
  supabase: SupabaseClient,
  basketId: string
): Promise<{ complete: boolean; missing: string[]; present: string[] }> {
  const anchors = await listAnchorsWithStatus(supabase, basketId);

  const approvedRoles = new Set(
    anchors
      .filter(a => a.lifecycle === 'approved')
      .map(a => a.anchor_key)
  );

  const present = FOUNDATION_ROLES.filter(role => approvedRoles.has(role));
  const missing = FOUNDATION_ROLES.filter(role => !approvedRoles.has(role));

  return {
    complete: missing.length === 0,
    missing: [...missing],
    present: [...present],
  };
}

/**
 * Get blocks that match specific context roles.
 */
export async function getBlocksByRoles(
  supabase: SupabaseClient,
  basketId: string,
  roles: string[]
): Promise<BlockWithRole[]> {
  const { data, error } = await supabase
    .from('blocks')
    .select('id, basket_id, title, body_md, content, metadata, semantic_type, state, status, updated_at, created_at, anchor_role, anchor_status, anchor_confidence, refresh_policy')
    .eq('basket_id', basketId)
    .in('anchor_role', roles)
    .eq('anchor_status', 'accepted')
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to load blocks by roles: ${error.message}`);
  }

  return (data || []) as BlockWithRole[];
}

/**
 * Check freshness of specific roles for recipe execution.
 * Returns true if all roles are present and fresh.
 */
export async function checkRolesFreshness(
  supabase: SupabaseClient,
  basketId: string,
  requiredRoles: string[]
): Promise<{ fresh: boolean; staleRoles: string[]; missingRoles: string[] }> {
  if (requiredRoles.length === 0) {
    return { fresh: true, staleRoles: [], missingRoles: [] };
  }

  const blocks = await getBlocksByRoles(supabase, basketId, requiredRoles);
  const roleToBlock = new Map<string, BlockWithRole>();

  for (const block of blocks) {
    // Take the most recent block for each role
    if (!roleToBlock.has(block.anchor_role) ||
        (block.updated_at && block.updated_at > (roleToBlock.get(block.anchor_role)!.updated_at ?? ''))) {
      roleToBlock.set(block.anchor_role, block);
    }
  }

  const missingRoles: string[] = [];
  const staleRoles: string[] = [];

  for (const role of requiredRoles) {
    const block = roleToBlock.get(role);
    if (!block) {
      missingRoles.push(role);
      continue;
    }

    const ttlHours = block.refresh_policy?.ttl_hours;
    if (computeIsStale(block.updated_at, ttlHours)) {
      staleRoles.push(role);
    }
  }

  return {
    fresh: missingRoles.length === 0 && staleRoles.length === 0,
    staleRoles,
    missingRoles,
  };
}
