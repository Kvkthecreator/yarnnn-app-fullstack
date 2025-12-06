'use client';

/**
 * ContextChangesGroup
 *
 * Displays multiple context changes with expand/collapse functionality.
 * Shows compact summary when collapsed, full cards when expanded.
 *
 * Display rules:
 * - 1 item: Show full card inline
 * - 2-3 items: Show expandable group
 * - 4+ items: Show summary with "View All" link
 *
 * Part of Chat-First Architecture v1.0
 * See: /docs/architecture/CHAT_FIRST_ARCHITECTURE_V1.md
 */

import { useState } from 'react';
import type { TPContextChangeRich } from '@/lib/types/thinking-partner';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, ExternalLink, Package } from 'lucide-react';
import { ContextChangeCard } from './ContextChangeCard';

interface ContextChangesGroupProps {
  changes: TPContextChangeRich[];
  onNavigate?: (itemId: string) => void;
  onViewAll?: () => void;
  maxInline?: number;
}

export function ContextChangesGroup({
  changes,
  onNavigate,
  onViewAll,
  maxInline = 3,
}: ContextChangesGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (changes.length === 0) {
    return null;
  }

  // Single item: show full card
  if (changes.length === 1) {
    return (
      <div className="mt-3 border-t border-border/50 pt-3">
        <ContextChangeCard change={changes[0]} onNavigate={onNavigate} />
      </div>
    );
  }

  // Multiple items: show group
  const showExpandable = changes.length <= maxInline + 1;
  const displayedChanges = isExpanded ? changes : changes.slice(0, 1);

  // Group summary text
  const summaryText = changes
    .map((c) => c.title || c.item_type.replace('_', ' '))
    .join(', ');

  // Count by action
  const writtenCount = changes.filter((c) => c.action === 'written').length;
  const proposedCount = changes.filter((c) => c.action === 'proposed').length;

  return (
    <div className="mt-3 border-t border-border/50 pt-3">
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between rounded-lg border bg-muted/30 p-2',
          showExpandable && 'cursor-pointer hover:bg-muted/50'
        )}
        onClick={() => showExpandable && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-primary/10 p-1.5">
            <Package className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              {changes.length} Context Items Updated
              {showExpandable && (
                isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )
              )}
            </div>
            {!isExpanded && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {writtenCount > 0 && (
                  <span className="text-green-600">{writtenCount} written</span>
                )}
                {writtenCount > 0 && proposedCount > 0 && <span>·</span>}
                {proposedCount > 0 && (
                  <span className="text-amber-600">{proposedCount} pending</span>
                )}
              </div>
            )}
          </div>
        </div>

        {!showExpandable && onViewAll && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewAll();
            }}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View All
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && showExpandable && (
        <div className="mt-2 space-y-2">
          {changes.map((change, idx) => (
            <ContextChangeCard
              key={change.item_id || idx}
              change={change}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}

      {/* Collapsed preview: show compact badges */}
      {!isExpanded && showExpandable && (
        <div className="mt-2 flex flex-wrap gap-1">
          {changes.map((change, idx) => (
            <ContextChangeCard
              key={change.item_id || idx}
              change={change}
              onNavigate={onNavigate}
              compact
            />
          ))}
        </div>
      )}

      {/* Many items: show summary only */}
      {!showExpandable && (
        <div className="mt-2 flex flex-wrap gap-1">
          {changes.slice(0, 4).map((change, idx) => (
            <ContextChangeCard
              key={change.item_id || idx}
              change={change}
              onNavigate={onNavigate}
              compact
            />
          ))}
          {changes.length > 4 && (
            <span className="inline-flex items-center rounded-md border bg-muted px-2 py-1 text-xs text-muted-foreground">
              +{changes.length - 4} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default ContextChangesGroup;
