'use client';

/**
 * ContextWindowContent
 *
 * Content for the Context floating window.
 * Displays context items by tier with search, filtering, and highlighting.
 * Features realtime updates via Supabase subscriptions.
 *
 * Part of Desktop UI Architecture v2.0 (Live Workspace)
 * See: /docs/implementation/DESKTOP_UI_IMPLEMENTATION_PLAN.md
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  Search,
  ChevronRight,
  Plus,
  FileText,
  Target,
  Users,
  Lightbulb,
  Palette,
  TrendingUp,
  CheckCircle2,
  Loader2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useBasketId, useDesktop } from '../DesktopProvider';
import { useContextItemsRealtime, type RealtimeEvent, type RealtimeContextItem } from '@/hooks/useTPRealtime';

// ============================================================================
// Types
// ============================================================================

interface ContextItem {
  id: string;
  item_type: string;
  title?: string;
  content: Record<string, unknown>;
  tier: 'foundation' | 'working' | 'ephemeral';
  status: 'active' | 'archived' | 'superseded';
  completeness_score?: number;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Constants
// ============================================================================

const ITEM_TYPE_ICONS: Record<string, React.ElementType> = {
  problem: Target,
  customer: Users,
  vision: Lightbulb,
  brand: Palette,
  competitor: TrendingUp,
  trend_digest: TrendingUp,
  market_intel: TrendingUp,
  note: FileText,
  insight: Lightbulb,
  default: FileText,
};

const TIER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  foundation: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  working: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  ephemeral: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200' },
};

// ============================================================================
// Component
// ============================================================================

export function ContextWindowContent() {
  const basketId = useBasketId();
  const { getHighlight } = useDesktop();
  const highlight = getHighlight('context');

  const [items, setItems] = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTier, setFilterTier] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<ContextItem | null>(null);

  // Track recently changed items for highlight animation
  const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(new Set());
  const recentlyChangedTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Realtime subscription handler
  const handleRealtimeUpdate = useCallback((event: RealtimeEvent<RealtimeContextItem>) => {
    const { type, data } = event;

    if (type === 'INSERT') {
      // Fetch full item data since realtime only gives partial
      fetch(`/api/baskets/${basketId}/context/${data.id}`)
        .then(res => res.ok ? res.json() : null)
        .then(fullItem => {
          if (fullItem) {
            setItems(prev => [fullItem, ...prev]);
            // Mark as recently changed for animation
            setRecentlyChanged(prev => new Set([...prev, data.id]));
            // Clear highlight after 3 seconds
            const timeout = setTimeout(() => {
              setRecentlyChanged(prev => {
                const next = new Set(prev);
                next.delete(data.id);
                return next;
              });
            }, 3000);
            recentlyChangedTimeoutRef.current.set(data.id, timeout);
          }
        })
        .catch(console.error);
    } else if (type === 'UPDATE') {
      // Fetch updated item data
      fetch(`/api/baskets/${basketId}/context/${data.id}`)
        .then(res => res.ok ? res.json() : null)
        .then(fullItem => {
          if (fullItem) {
            setItems(prev => prev.map(item => item.id === data.id ? fullItem : item));
            // Mark as recently changed for animation
            setRecentlyChanged(prev => new Set([...prev, data.id]));
            // Clear highlight after 3 seconds
            const timeout = setTimeout(() => {
              setRecentlyChanged(prev => {
                const next = new Set(prev);
                next.delete(data.id);
                return next;
              });
            }, 3000);
            // Clear any existing timeout
            const existing = recentlyChangedTimeoutRef.current.get(data.id);
            if (existing) clearTimeout(existing);
            recentlyChangedTimeoutRef.current.set(data.id, timeout);
          }
        })
        .catch(console.error);
    } else if (type === 'DELETE') {
      setItems(prev => prev.filter(item => item.id !== data.id));
    }
  }, [basketId]);

  // Subscribe to realtime updates
  const { isConnected } = useContextItemsRealtime(basketId || '', handleRealtimeUpdate);

  // Cleanup timeouts on unmount
  useEffect(() => {
    const timeouts = recentlyChangedTimeoutRef.current;
    return () => {
      timeouts.forEach(timeout => clearTimeout(timeout));
      timeouts.clear();
    };
  }, []);

  // Fetch context items
  const fetchItems = useCallback(async () => {
    if (!basketId) return;

    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/baskets/${basketId}/context`);
      if (!response.ok) {
        throw new Error('Failed to fetch context items');
      }
      const data = await response.json();
      setItems(data.items || data || []);
    } catch (err) {
      console.error('Failed to fetch context items:', err);
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [basketId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const title = (item.title || '').toLowerCase();
        const type = item.item_type.toLowerCase();
        const contentStr = JSON.stringify(item.content).toLowerCase();
        if (!title.includes(query) && !type.includes(query) && !contentStr.includes(query)) {
          return false;
        }
      }

      // Tier filter
      if (filterTier && item.tier !== filterTier) {
        return false;
      }

      return true;
    });
  }, [items, searchQuery, filterTier]);

  // Group items by tier
  const groupedItems = useMemo(() => {
    const groups: Record<string, ContextItem[]> = {
      foundation: [],
      working: [],
      ephemeral: [],
    };

    filteredItems.forEach((item) => {
      const tier = item.tier || 'working';
      if (groups[tier]) {
        groups[tier].push(item);
      }
    });

    return groups;
  }, [filteredItems]);

  // Check if item is highlighted (from TP actions)
  const isHighlighted = useCallback(
    (itemId: string) => {
      return highlight?.itemIds?.includes(itemId) ?? false;
    },
    [highlight]
  );

  // Check if item was recently changed (for animation)
  const isRecentlyChanged = useCallback(
    (itemId: string) => {
      return recentlyChanged.has(itemId);
    },
    [recentlyChanged]
  );

  // If viewing specific item
  if (selectedItem) {
    return (
      <ContextItemDetail
        item={selectedItem}
        onBack={() => setSelectedItem(null)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search and Filter */}
      <div className="border-b border-border p-4 space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search context items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-input bg-background py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Tier filters */}
        <div className="flex items-center gap-2">
          {['foundation', 'working', 'ephemeral'].map((tier) => {
            const colors = TIER_COLORS[tier];
            const isActive = filterTier === tier;
            const count = groupedItems[tier]?.length || 0;
            return (
              <button
                key={tier}
                onClick={() => setFilterTier(isActive ? null : tier)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                  isActive
                    ? `${colors.bg} ${colors.text} border ${colors.border}`
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                {tier} ({count})
              </button>
            );
          })}
          {filterTier && (
            <button
              onClick={() => setFilterTier(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        {/* Highlight indicator */}
        {highlight?.action && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              {highlight.action === 'reading' && 'TP is reading:'}
              {highlight.action === 'writing' && 'TP is writing:'}
              {highlight.action === 'using' && 'TP is using:'}
            </span>
            <Badge variant="secondary" className="font-normal">
              {highlight.itemIds?.length || 0} item(s)
            </Badge>
          </div>
        )}

        {/* Connection status */}
        <div className="flex items-center gap-1.5 text-xs">
          {isConnected ? (
            <>
              <Wifi className="h-3 w-3 text-green-500" />
              <span className="text-green-600">Live</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Connecting...</span>
            </>
          )}
        </div>
      </div>

      {/* Items List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={fetchItems}>
              Retry
            </Button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-sm font-medium">No context items</p>
            <p className="text-xs text-muted-foreground mt-1">
              {searchQuery ? 'Try adjusting your search' : 'Chat with TP to add context'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {/* Foundation */}
            {groupedItems.foundation.length > 0 && (
              <ContextItemGroup
                title="Foundation"
                tier="foundation"
                items={groupedItems.foundation}
                onItemClick={setSelectedItem}
                isHighlighted={isHighlighted}
                isRecentlyChanged={isRecentlyChanged}
              />
            )}

            {/* Working */}
            {groupedItems.working.length > 0 && (
              <ContextItemGroup
                title="Working"
                tier="working"
                items={groupedItems.working}
                onItemClick={setSelectedItem}
                isHighlighted={isHighlighted}
                isRecentlyChanged={isRecentlyChanged}
              />
            )}

            {/* Ephemeral */}
            {groupedItems.ephemeral.length > 0 && (
              <ContextItemGroup
                title="Ephemeral"
                tier="ephemeral"
                items={groupedItems.ephemeral}
                onItemClick={setSelectedItem}
                isHighlighted={isHighlighted}
                isRecentlyChanged={isRecentlyChanged}
              />
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        {filteredItems.length} of {items.length} items
      </div>
    </div>
  );
}

// ============================================================================
// Context Item Group
// ============================================================================

interface ContextItemGroupProps {
  title: string;
  tier: string;
  items: ContextItem[];
  onItemClick: (item: ContextItem) => void;
  isHighlighted: (itemId: string) => boolean;
  isRecentlyChanged: (itemId: string) => boolean;
}

function ContextItemGroup({
  title,
  tier,
  items,
  onItemClick,
  isHighlighted,
  isRecentlyChanged,
}: ContextItemGroupProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const colors = TIER_COLORS[tier] || TIER_COLORS.working;

  return (
    <div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex w-full items-center justify-between px-4 py-2 text-xs font-medium',
          colors.bg,
          colors.text
        )}
      >
        <span>
          {title} ({items.length})
        </span>
        <ChevronRight
          className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-90')}
        />
      </button>

      {isExpanded && (
        <div className="divide-y divide-border/50">
          {items.map((item) => (
            <ContextItemRow
              key={item.id}
              item={item}
              onClick={() => onItemClick(item)}
              highlighted={isHighlighted(item.id)}
              recentlyChanged={isRecentlyChanged(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Context Item Row
// ============================================================================

interface ContextItemRowProps {
  item: ContextItem;
  onClick: () => void;
  highlighted?: boolean;
  recentlyChanged?: boolean;
}

function ContextItemRow({ item, onClick, highlighted, recentlyChanged }: ContextItemRowProps) {
  const Icon = ITEM_TYPE_ICONS[item.item_type] || ITEM_TYPE_ICONS.default;
  const tierColors = TIER_COLORS[item.tier] || TIER_COLORS.working;

  const previewText = useMemo(() => {
    const content = item.content;
    const textFields = ['description', 'summary', 'content', 'text', 'body', 'note'];
    for (const field of textFields) {
      if (typeof content[field] === 'string') {
        return (content[field] as string).slice(0, 100);
      }
    }
    for (const value of Object.values(content)) {
      if (typeof value === 'string' && value.length > 10) {
        return value.slice(0, 100);
      }
    }
    return '';
  }, [item.content]);

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 p-3 text-left transition-all duration-300',
        highlighted
          ? 'bg-primary/5 border-l-2 border-l-primary'
          : recentlyChanged
          ? 'bg-green-50 border-l-2 border-l-green-500 animate-pulse'
          : 'hover:bg-muted/50'
      )}
    >
      <div className={cn(
        'rounded-md p-1.5 shrink-0 transition-all',
        recentlyChanged ? 'bg-green-100 ring-2 ring-green-300' : tierColors.bg
      )}>
        <Icon className={cn('h-4 w-4', recentlyChanged ? 'text-green-600' : tierColors.text)} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {item.title || item.item_type.replace('_', ' ')}
          </span>
          {highlighted && (
            <Badge variant="secondary" className="text-[10px] shrink-0">
              In Use
            </Badge>
          )}
          {recentlyChanged && (
            <Badge className="text-[10px] shrink-0 bg-green-100 text-green-700 border-green-200">
              Updated
            </Badge>
          )}
        </div>

        {previewText && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
            {previewText}
          </p>
        )}

        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="capitalize">{item.item_type.replace('_', ' ')}</span>
          {item.completeness_score !== undefined && (
            <>
              <span>·</span>
              <span>{Math.round(item.completeness_score * 100)}%</span>
            </>
          )}
        </div>
      </div>

      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
    </button>
  );
}

// ============================================================================
// Context Item Detail
// ============================================================================

interface ContextItemDetailProps {
  item: ContextItem;
  onBack: () => void;
}

function ContextItemDetail({ item, onBack }: ContextItemDetailProps) {
  const Icon = ITEM_TYPE_ICONS[item.item_type] || ITEM_TYPE_ICONS.default;
  const tierColors = TIER_COLORS[item.tier] || TIER_COLORS.working;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border p-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="mb-3 -ml-2"
        >
          <ChevronRight className="h-4 w-4 rotate-180 mr-1" />
          Back
        </Button>

        <div className="flex items-start gap-3">
          <div className={cn('rounded-lg p-2', tierColors.bg)}>
            <Icon className={cn('h-6 w-6', tierColors.text)} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">
                {item.title || item.item_type.replace('_', ' ')}
              </h3>
              <Badge
                className={cn(
                  'capitalize',
                  tierColors.bg,
                  tierColors.text,
                  'border',
                  tierColors.border
                )}
              >
                {item.tier}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 capitalize">
              {item.item_type.replace('_', ' ')} · {item.status}
            </p>
          </div>
        </div>

        {/* Completeness */}
        {item.completeness_score !== undefined && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Completeness</span>
              <span className="font-medium">
                {Math.round(item.completeness_score * 100)}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${item.completeness_score * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {Object.entries(item.content).map(([key, value]) => (
          <div key={key}>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {key.replace(/_/g, ' ')}
            </label>
            <div className="mt-1 text-sm">
              {typeof value === 'string' ? (
                <p className="whitespace-pre-wrap">{value}</p>
              ) : Array.isArray(value) ? (
                <ul className="list-disc list-inside space-y-1">
                  {value.map((v, i) => (
                    <li key={i}>{String(v)}</li>
                  ))}
                </ul>
              ) : (
                <pre className="rounded-md bg-muted p-2 text-xs overflow-x-auto">
                  {JSON.stringify(value, null, 2)}
                </pre>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        Updated {new Date(item.updated_at).toLocaleString()}
      </div>
    </div>
  );
}

export default ContextWindowContent;
