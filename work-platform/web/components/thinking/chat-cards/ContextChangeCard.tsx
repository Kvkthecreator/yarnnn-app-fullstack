'use client';

/**
 * ContextChangeCard
 *
 * Displays a single context item change in chat messages.
 * Shows item type, action, tier badge, and preview with navigation.
 *
 * Part of Chat-First Architecture v1.0
 * See: /docs/architecture/CHAT_FIRST_ARCHITECTURE_V1.md
 */

import type { TPContextChangeRich } from '@/lib/types/thinking-partner';
import { cn } from '@/lib/utils';
import {
  FileText,
  User,
  Target,
  Palette,
  TrendingUp,
  Users,
  Lightbulb,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

interface ContextChangeCardProps {
  change: TPContextChangeRich;
  onNavigate?: (itemId: string) => void;
  compact?: boolean;
}

// Item type to icon mapping
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

// Tier to color mapping
const TIER_COLORS: Record<string, string> = {
  foundation: 'bg-blue-100 text-blue-700 border-blue-200',
  working: 'bg-purple-100 text-purple-700 border-purple-200',
  ephemeral: 'bg-gray-100 text-gray-600 border-gray-200',
};

// Action to status mapping
const ACTION_STATUS: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
  written: { label: 'Written', color: 'text-green-600', Icon: CheckCircle2 },
  proposed: { label: 'Pending Approval', color: 'text-amber-600', Icon: Clock },
  unknown: { label: 'Updated', color: 'text-muted-foreground', Icon: AlertCircle },
};

export function ContextChangeCard({
  change,
  onNavigate,
  compact = false,
}: ContextChangeCardProps) {
  const IconComponent = ITEM_TYPE_ICONS[change.item_type] || ITEM_TYPE_ICONS.default;
  const tierColor = TIER_COLORS[change.tier || 'working'];
  const actionStatus = ACTION_STATUS[change.action] || ACTION_STATUS.unknown;

  const handleClick = () => {
    if (onNavigate && change.item_id) {
      onNavigate(change.item_id);
    }
  };

  if (compact) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs',
          tierColor,
          onNavigate && change.item_id && 'cursor-pointer hover:opacity-80'
        )}
        onClick={handleClick}
      >
        <IconComponent className="h-3 w-3" />
        <span className="font-medium capitalize">{change.item_type.replace('_', ' ')}</span>
        <actionStatus.Icon className={cn('h-3 w-3', actionStatus.color)} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3 transition-colors',
        onNavigate && change.item_id && 'cursor-pointer hover:bg-muted/50'
      )}
      onClick={handleClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={cn('rounded-md p-1.5', tierColor.split(' ')[0])}>
            <IconComponent className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium capitalize">
                {change.title || change.item_type.replace('_', ' ')}
              </span>
              {change.tier && (
                <Badge variant="outline" className={cn('text-xs capitalize', tierColor)}>
                  {change.tier}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <actionStatus.Icon className={cn('h-3 w-3', actionStatus.color)} />
              <span className={actionStatus.color}>{actionStatus.label}</span>
              {change.created_by && (
                <>
                  <span className="text-muted-foreground">by</span>
                  <span className="text-muted-foreground">
                    {change.created_by.startsWith('agent:') ? 'Agent' : 'You'}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {onNavigate && change.item_id && (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* Preview */}
      {change.preview && (
        <div className="mt-2 text-xs text-muted-foreground line-clamp-2">
          {change.preview}
        </div>
      )}

      {/* Completeness indicator */}
      {change.completeness_score !== undefined && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${change.completeness_score * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {Math.round(change.completeness_score * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}

export default ContextChangeCard;
