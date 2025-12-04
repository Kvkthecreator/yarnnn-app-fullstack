"use client";

/**
 * useContextItems - Hook for fetching and managing context items
 *
 * v3.0 Terminology:
 * - item_type: Type of context item (replaces anchor_role)
 * - item_key: Optional key for non-singleton types (replaces entry_key)
 * - content: Structured JSONB data (replaces data)
 * - tier: Governance tier (foundation, working, ephemeral)
 *
 * Provides:
 * - Schema fetching (available context types)
 * - Item CRUD operations
 * - Completeness tracking
 * - Resolved items (with asset URLs)
 *
 * See: /docs/architecture/ADR_CONTEXT_ITEMS_UNIFIED.md
 */

import { useCallback, useEffect, useState } from "react";

// ============================================================================
// Types (v3.0)
// ============================================================================

export interface FieldDefinition {
  key: string;
  type: 'text' | 'longtext' | 'array' | 'asset';
  label: string;
  required?: boolean;
  placeholder?: string;
  help?: string;
  item_type?: string;
  accept?: string;
}

export interface ContextItemSchema {
  item_type: string;
  display_name: string;
  description: string;
  icon: string;
  category: 'foundation' | 'market' | 'insight';
  is_singleton: boolean;
  field_schema: {
    fields: FieldDefinition[];
    agent_produced?: boolean;
    refresh_ttl_hours?: number;
  };
  sort_order: number;
}

export interface ContextItem {
  id: string;
  basket_id: string;
  item_type: string;
  item_key?: string;
  title?: string;
  content: Record<string, unknown>;
  tier: 'foundation' | 'working' | 'ephemeral';
  completeness_score?: number;
  status: 'active' | 'archived';
  created_by?: string;
  updated_by?: string;
  created_at: string;
  updated_at: string;
  // Schema info (optional, joined)
  schema_display_name?: string;
  schema_icon?: string;
  schema_category?: string;
}

export interface ContextItemResolved extends ContextItem {
  resolved_content: Record<string, unknown>;
}

export interface CompletenessData {
  score: number;
  required_fields: number;
  filled_fields: number;
  missing_fields: string[];
}

// ============================================================================
// useContextSchemas - Fetch available context item schemas
// ============================================================================

export function useContextSchemas(basketId: string) {
  const [schemas, setSchemas] = useState<ContextItemSchema[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSchemas = useCallback(async () => {
    if (!basketId) return;

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/substrate/baskets/${basketId}/context/schemas`);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Please sign in to view context schemas');
        }
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to fetch schemas');
      }

      const data = await response.json();
      setSchemas(data.schemas || []);
      return data.schemas;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[useContextSchemas] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [basketId]);

  useEffect(() => {
    fetchSchemas();
  }, [fetchSchemas]);

  // Group schemas by category
  const schemasByCategory = {
    foundation: schemas.filter(s => s.category === 'foundation'),
    market: schemas.filter(s => s.category === 'market'),
    insight: schemas.filter(s => s.category === 'insight'),
  };

  // Group by tier (mapped from category)
  const schemasByTier = {
    foundation: schemas.filter(s => s.category === 'foundation'),
    working: schemas.filter(s => s.category === 'market' || s.category === 'insight'),
    ephemeral: [] as ContextItemSchema[],
  };

  return {
    schemas,
    schemasByCategory,
    schemasByTier,
    loading,
    error,
    refetch: fetchSchemas,
  };
}

// ============================================================================
// useContextItems - Fetch and manage context items for a basket
// ============================================================================

export interface UseContextItemsOptions {
  /** Filter by item type */
  itemType?: string;
  /** Filter by tier */
  tier?: string;
  /** Whether to auto-fetch on mount */
  autoFetch?: boolean;
}

export function useContextItems(basketId: string, options: UseContextItemsOptions = {}) {
  const { itemType, tier, autoFetch = true } = options;

  const [items, setItems] = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!basketId) return;

    try {
      setLoading(true);
      setError(null);

      let url = `/api/substrate/baskets/${basketId}/context/items`;
      const params = new URLSearchParams();

      if (itemType) {
        url = `/api/substrate/baskets/${basketId}/context/items/${itemType}`;
      }
      if (tier) {
        params.set('tier', tier);
      }

      const queryString = params.toString();
      if (queryString && !itemType) {
        url += `?${queryString}`;
      }

      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404 && itemType) {
          // No item exists for this type yet - that's okay
          setItems([]);
          return [];
        }
        if (response.status === 401) {
          throw new Error('Please sign in to view context items');
        }
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to fetch items');
      }

      const data = await response.json();

      // Handle single item vs list
      if (itemType) {
        setItems([data]);
        return [data];
      } else {
        setItems(data.items || []);
        return data.items;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[useContextItems] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [basketId, itemType, tier]);

  useEffect(() => {
    if (autoFetch) {
      fetchItems();
    }
  }, [fetchItems, autoFetch]);

  // Create or update an item
  const saveItem = useCallback(async (
    type: string,
    content: Record<string, unknown>,
    options?: { item_key?: string; title?: string }
  ) => {
    try {
      let url = `/api/substrate/baskets/${basketId}/context/items/${type}`;
      if (options?.item_key) {
        url += `?item_key=${encodeURIComponent(options.item_key)}`;
      }

      const payload: Record<string, unknown> = { content };
      if (options?.title) payload.title = options.title;

      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to save item');
      }

      const saved = await response.json();

      // Update local state
      setItems(prev => {
        const idx = prev.findIndex(e => e.id === saved.id);
        if (idx >= 0) {
          return [...prev.slice(0, idx), saved, ...prev.slice(idx + 1)];
        }
        return [...prev, saved];
      });

      return saved;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    }
  }, [basketId]);

  // Archive an item
  const archiveItem = useCallback(async (type: string, itemKey?: string) => {
    try {
      let url = `/api/substrate/baskets/${basketId}/context/items/${type}`;
      if (itemKey) {
        url += `?item_key=${encodeURIComponent(itemKey)}`;
      }

      const response = await fetch(url, { method: 'DELETE' });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to archive item');
      }

      // Update local state
      setItems(prev => prev.filter(e =>
        !(e.item_type === type && (!itemKey || e.item_key === itemKey))
      ));

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    }
  }, [basketId]);

  // Get item by type
  const getItemByType = useCallback((type: string, itemKey?: string) => {
    return items.find(e =>
      e.item_type === type && (!itemKey || e.item_key === itemKey)
    );
  }, [items]);

  // Group items by tier
  const getItemsByTier = useCallback(() => {
    return {
      foundation: items.filter(i => i.tier === 'foundation'),
      working: items.filter(i => i.tier === 'working'),
      ephemeral: items.filter(i => i.tier === 'ephemeral'),
    };
  }, [items]);

  // Group items by category (needs schemas)
  const getItemsByCategory = useCallback((schemas: ContextItemSchema[]) => {
    const result: Record<string, ContextItem[]> = {
      foundation: [],
      market: [],
      insight: [],
    };

    items.forEach(item => {
      const schema = schemas.find(s => s.item_type === item.item_type);
      if (schema) {
        result[schema.category].push(item);
      }
    });

    return result;
  }, [items]);

  return {
    items,
    loading,
    error,
    refetch: fetchItems,
    saveItem,
    archiveItem,
    getItemByType,
    getItemsByTier,
    getItemsByCategory,
  };
}

// ============================================================================
// useContextCompleteness - Fetch completeness for a specific item
// ============================================================================

export function useContextCompleteness(basketId: string, itemType: string) {
  const [completeness, setCompleteness] = useState<CompletenessData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCompleteness = useCallback(async () => {
    if (!basketId || !itemType) return;

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `/api/substrate/baskets/${basketId}/context/items/${itemType}/completeness`
      );

      if (!response.ok) {
        if (response.status === 404) {
          // No item exists yet
          setCompleteness(null);
          return null;
        }
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to fetch completeness');
      }

      const data = await response.json();
      setCompleteness(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[useContextCompleteness] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [basketId, itemType]);

  useEffect(() => {
    fetchCompleteness();
  }, [fetchCompleteness]);

  return {
    completeness,
    loading,
    error,
    refetch: fetchCompleteness,
    isComplete: completeness?.score === 1,
    score: completeness?.score ?? 0,
  };
}

// ============================================================================
// useResolvedItem - Fetch item with resolved asset URLs
// ============================================================================

export function useResolvedItem(basketId: string, itemType: string) {
  const [item, setItem] = useState<ContextItemResolved | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItem = useCallback(async () => {
    if (!basketId || !itemType) return;

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `/api/substrate/baskets/${basketId}/context/items/${itemType}/resolved`
      );

      if (!response.ok) {
        if (response.status === 404) {
          setItem(null);
          return null;
        }
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to fetch item');
      }

      const data = await response.json();
      setItem(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[useResolvedItem] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [basketId, itemType]);

  useEffect(() => {
    fetchItem();
  }, [fetchItem]);

  return {
    item,
    loading,
    error,
    refetch: fetchItem,
  };
}

// ============================================================================
// useBulkContext - Fetch multiple context items at once (for recipes)
// ============================================================================

export function useBulkContext(basketId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBulk = useCallback(async (itemTypes: string[], options?: {
    resolve_assets?: boolean;
    include_completeness?: boolean;
  }) => {
    if (!basketId || !itemTypes.length) return {};

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `/api/substrate/baskets/${basketId}/context/bulk`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_types: itemTypes,
            resolve_assets: options?.resolve_assets ?? false,
            include_completeness: options?.include_completeness ?? false,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to fetch bulk context');
      }

      const data = await response.json();
      return data.items || {};
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[useBulkContext] Error:', err);
      return {};
    } finally {
      setLoading(false);
    }
  }, [basketId]);

  return {
    fetchBulk,
    loading,
    error,
  };
}

// ============================================================================
// Backward Compatibility Exports (deprecated)
// ============================================================================

/** @deprecated Use ContextItemSchema instead */
export type ContextEntrySchema = ContextItemSchema;

/** @deprecated Use ContextItem instead */
export type ContextEntry = ContextItem;

/** @deprecated Use useContextItems instead */
export const useContextEntries = useContextItems;
