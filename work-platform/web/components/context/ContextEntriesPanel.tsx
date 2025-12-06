"use client";

/**
 * ContextEntriesPanel - Windows Explorer-style context management
 *
 * Architecture (Refactored Dec 2025):
 * - Two view modes: List (compact) and Grid (detailed preview)
 * - Click navigates to detail page (bento layout)
 * - No inline expansion - detail page handles full content
 * - Realtime updates via Supabase
 *
 * See: /docs/architecture/ADR_CONTEXT_ITEMS_UNIFIED.md
 */

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  Plus,
  Pencil,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Users,
  Eye,
  Palette,
  Target,
  TrendingUp,
  BarChart3,
  Loader2,
  RefreshCw,
  User,
  Bot,
  Sparkles,
  Lightbulb,
  List,
  LayoutGrid,
  ChevronRight,
} from 'lucide-react';
// Link removed - using router.push for navigation
import {
  useContextSchemas,
  useContextEntries,
  type ContextEntrySchema,
  type ContextEntry,
} from '@/hooks/useContextEntries';
import { useContextItemsRealtime } from '@/hooks/useTPRealtime';
import ContextEntryEditor from './ContextEntryEditor';

// =============================================================================
// CONSTANTS & CONFIG
// =============================================================================

type ViewMode = 'list' | 'grid';

const ROLE_ICONS: Record<string, React.ElementType> = {
  problem: AlertTriangle,
  customer: Users,
  vision: Eye,
  brand: Palette,
  competitor: Target,
  trend_digest: TrendingUp,
  market_intel: Lightbulb,
  competitor_snapshot: BarChart3,
};

const TIER_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  foundation: { label: 'Foundation', color: 'text-blue-700', bgColor: 'bg-blue-500/10 border-blue-500/30' },
  working: { label: 'Working', color: 'text-purple-700', bgColor: 'bg-purple-500/10 border-purple-500/30' },
  ephemeral: { label: 'Ephemeral', color: 'text-gray-600', bgColor: 'bg-gray-500/10 border-gray-500/30' },
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  trend_digest: 'Trend Digest',
  market_intel: 'Market Intelligence',
  competitor_snapshot: 'Competitor Snapshot',
  problem: 'Problem',
  customer: 'Customer',
  vision: 'Vision',
  brand: 'Brand Identity',
  competitor: 'Competitor',
};

const CATEGORY_CONFIG = {
  foundation: {
    title: 'Foundation',
    description: 'Core context that defines your project',
    color: 'bg-blue-500',
  },
  market: {
    title: 'Market Intelligence',
    description: 'Competitive landscape and market data',
    color: 'bg-purple-500',
  },
  insight: {
    title: 'Agent Insights',
    description: 'AI-generated analysis and recommendations',
    color: 'bg-green-500',
  },
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

interface ContextEntriesPanelProps {
  projectId: string;
  basketId: string;
  initialAnchorRole?: string;
}

export default function ContextEntriesPanel({
  projectId,
  basketId,
  initialAnchorRole,
}: ContextEntriesPanelProps) {
  const router = useRouter();

  // View mode state - persisted to localStorage
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('context-view-mode') as ViewMode) || 'list';
    }
    return 'list';
  });

  // Persist view mode
  useEffect(() => {
    localStorage.setItem('context-view-mode', viewMode);
  }, [viewMode]);

  // Fetch schemas and entries
  const {
    schemas,
    schemasByCategory,
    loading: schemasLoading,
    error: schemasError,
    refetch: refetchSchemas,
  } = useContextSchemas(basketId);

  const {
    entries,
    loading: entriesLoading,
    error: entriesError,
    refetch: refetchEntries,
    getEntryByRole,
  } = useContextEntries(basketId);

  // Realtime updates
  useContextItemsRealtime(basketId, () => {
    refetchEntries();
  });

  // Editor modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSchema, setEditingSchema] = useState<ContextEntrySchema | null>(null);
  const [editingEntry, setEditingEntry] = useState<ContextEntry | null>(null);
  const [editingEntryKey, setEditingEntryKey] = useState<string | undefined>();
  const [initialRoleHandled, setInitialRoleHandled] = useState(false);

  // Open editor for a schema
  const openEditor = (schema: ContextEntrySchema, entry?: ContextEntry, entryKey?: string) => {
    setEditingSchema(schema);
    setEditingEntry(entry || null);
    setEditingEntryKey(entryKey);
    setEditorOpen(true);
  };

  // Auto-open editor for initialAnchorRole when data is loaded
  useEffect(() => {
    if (initialAnchorRole && !initialRoleHandled && schemas.length > 0 && !schemasLoading) {
      const schema = schemas.find((s) => s.anchor_role === initialAnchorRole);
      if (schema) {
        const entry = getEntryByRole(initialAnchorRole);
        openEditor(schema, entry || undefined);
        setInitialRoleHandled(true);
      }
    }
  }, [initialAnchorRole, schemas, schemasLoading, initialRoleHandled, getEntryByRole]);

  // Close editor
  const closeEditor = () => {
    setEditorOpen(false);
    setEditingSchema(null);
    setEditingEntry(null);
    setEditingEntryKey(undefined);
  };

  // Handle successful save
  const handleEditorSuccess = () => {
    refetchEntries();
    closeEditor();
  };

  // Navigate to detail page
  const navigateToDetail = (entryId: string) => {
    router.push(`/projects/${projectId}/context/${entryId}`);
  };

  // Calculate overall completeness
  const overallCompleteness = useMemo(() => {
    const foundationSchemas = schemasByCategory.foundation;
    if (foundationSchemas.length === 0) return 0;

    let filled = 0;
    foundationSchemas.forEach((schema) => {
      const entry = getEntryByRole(schema.anchor_role);
      if (entry && Object.keys(entry.data).length > 0) {
        filled++;
      }
    });

    return filled / foundationSchemas.length;
  }, [schemasByCategory.foundation, getEntryByRole]);

  // Filter agent-generated working-tier insights
  const agentInsights = useMemo(() => {
    return entries.filter(
      (entry) =>
        entry.tier === 'working' &&
        entry.source_type === 'agent' &&
        ['trend_digest', 'market_intel', 'competitor_snapshot'].includes(entry.anchor_role)
    );
  }, [entries]);

  const loading = schemasLoading || entriesLoading;
  const error = schemasError || entriesError;

  if (loading && schemas.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="h-8 w-8 text-destructive mb-2" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => {
            refetchSchemas();
            refetchEntries();
          }}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with completeness + view toggle */}
      <div className="flex items-center gap-4">
        {/* Completeness bar */}
        <div className="flex-1 flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
          <div className="flex-1">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-medium">Foundation Completeness</span>
              <span className="text-muted-foreground">
                {Math.round(overallCompleteness * 100)}%
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  overallCompleteness === 1
                    ? 'bg-green-500'
                    : overallCompleteness >= 0.5
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
                }`}
                style={{ width: `${overallCompleteness * 100}%` }}
              />
            </div>
          </div>
          {overallCompleteness === 1 ? (
            <CheckCircle className="h-6 w-6 text-green-500" />
          ) : (
            <AlertCircle className="h-6 w-6 text-muted-foreground" />
          )}
        </div>

        {/* View mode toggle */}
        <div className="flex items-center border rounded-lg p-1 bg-muted/30">
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 px-3"
            onClick={() => setViewMode('list')}
            title="List view"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 px-3"
            onClick={() => setViewMode('grid')}
            title="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Render each category */}
      {(Object.keys(CATEGORY_CONFIG) as Array<keyof typeof CATEGORY_CONFIG>).map((category) => {
        const config = CATEGORY_CONFIG[category];
        const categorySchemas = schemasByCategory[category];

        if (categorySchemas.length === 0) return null;

        return (
          <div key={category} className="space-y-4">
            {/* Category header */}
            <div className="flex items-center gap-3">
              <div className={`w-1 h-6 rounded-full ${config.color}`} />
              <div>
                <h3 className="font-semibold">{config.title}</h3>
                <p className="text-sm text-muted-foreground">{config.description}</p>
              </div>
            </div>

            {/* Items - List or Grid view */}
            {viewMode === 'list' ? (
              <div className="space-y-2">
                {categorySchemas.map((schema) => (
                  <ContextItemRow
                    key={schema.anchor_role}
                    schema={schema}
                    entry={getEntryByRole(schema.anchor_role) ?? null}
                    onNavigate={navigateToDetail}
                    onEdit={(entry) => openEditor(schema, entry)}
                    onAdd={() => openEditor(schema)}
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {categorySchemas.map((schema) => (
                  <ContextItemCard
                    key={schema.anchor_role}
                    schema={schema}
                    entry={getEntryByRole(schema.anchor_role) ?? null}
                    onNavigate={navigateToDetail}
                    onEdit={(entry) => openEditor(schema, entry)}
                    onAdd={() => openEditor(schema)}
                  />
                ))}
              </div>
            )}

            {/* Add competitor button for market category */}
            {category === 'market' && (
              <Button
                variant="outline"
                size="sm"
                className="border-dashed"
                onClick={() => {
                  const competitorSchema = categorySchemas.find(
                    (s) => s.anchor_role === 'competitor'
                  );
                  if (competitorSchema) {
                    openEditor(competitorSchema, undefined, `competitor-${Date.now()}`);
                  }
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Competitor
              </Button>
            )}
          </div>
        );
      })}

      {/* Agent Insights Section */}
      {agentInsights.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-6 rounded-full bg-purple-500" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">Agent Insights</h3>
                <Badge variant="secondary" className="text-xs">
                  {agentInsights.length}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                AI-generated analysis from scheduled research
              </p>
            </div>
          </div>

          {viewMode === 'list' ? (
            <div className="space-y-2">
              {agentInsights.map((entry) => (
                <AgentInsightRow
                  key={entry.id}
                  entry={entry}
                  onNavigate={navigateToDetail}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {agentInsights.map((entry) => (
                <AgentInsightCard
                  key={entry.id}
                  entry={entry}
                  onNavigate={navigateToDetail}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Editor modal */}
      {editingSchema && (
        <ContextEntryEditor
          projectId={projectId}
          basketId={basketId}
          anchorRole={editingSchema.anchor_role}
          entryKey={editingEntryKey}
          schema={editingSchema}
          entry={editingEntry}
          open={editorOpen}
          onClose={closeEditor}
          onSuccess={handleEditorSuccess}
        />
      )}
    </div>
  );
}

// =============================================================================
// LIST VIEW COMPONENTS
// =============================================================================

/**
 * Compact row for list view
 */
function ContextItemRow({
  schema,
  entry,
  onNavigate,
  onEdit,
  onAdd,
}: {
  schema: ContextEntrySchema;
  entry: ContextEntry | null;
  onNavigate: (id: string) => void;
  onEdit: (entry: ContextEntry) => void;
  onAdd: () => void;
}) {
  const Icon = ROLE_ICONS[schema.anchor_role] || AlertCircle;
  const hasContent = entry && Object.keys(entry.data).length > 0;

  return (
    <Card
      className={`group transition-all ${
        hasContent
          ? 'cursor-pointer hover:bg-muted/50'
          : 'border-dashed'
      }`}
      onClick={() => hasContent && entry && onNavigate(entry.id)}
    >
      <div className="flex items-center gap-4 p-4">
        {/* Icon */}
        <div
          className={`p-2 rounded-lg shrink-0 ${
            hasContent ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>

        {/* Title and meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{schema.display_name}</span>
            {entry && <SourceBadge entry={entry} />}
          </div>
          {!hasContent && (
            <p className="text-sm text-muted-foreground truncate">
              {schema.description}
            </p>
          )}
          {hasContent && entry && (
            <p className="text-sm text-muted-foreground truncate">
              {getContentPreview(entry.data, 80)}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {hasContent && entry ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(entry);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onAdd();
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Agent insight row for list view
 */
function AgentInsightRow({
  entry,
  onNavigate,
}: {
  entry: ContextEntry;
  onNavigate: (id: string) => void;
}) {
  const Icon = ROLE_ICONS[entry.anchor_role] || Sparkles;
  const typeLabel = ITEM_TYPE_LABELS[entry.anchor_role] || entry.anchor_role;
  const tierConfig = TIER_CONFIG[entry.tier || 'working'];

  const sourceRef = entry.source_ref as { agent_type?: string } | null;
  const agentType = sourceRef?.agent_type;

  return (
    <Card
      className="cursor-pointer hover:bg-purple-500/5 transition-all border-purple-500/20 bg-purple-500/5"
      onClick={() => onNavigate(entry.id)}
    >
      <div className="flex items-center gap-4 p-4">
        <div className="p-2 rounded-lg bg-purple-500/10 text-purple-600 shrink-0">
          <Icon className="h-5 w-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{entry.display_name || typeLabel}</span>
            <Badge variant="outline" className={`text-xs ${tierConfig.bgColor} ${tierConfig.color}`}>
              {tierConfig.label}
            </Badge>
            <Badge variant="secondary" className="text-xs gap-1">
              <Bot className="h-3 w-3" />
              {agentType || 'Agent'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground truncate mt-0.5">
            {getContentPreview(entry.data, 100)}
          </p>
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </div>
    </Card>
  );
}

// =============================================================================
// GRID VIEW COMPONENTS
// =============================================================================

/**
 * Detailed card for grid view - Windows Explorer "Details" style
 */
function ContextItemCard({
  schema,
  entry,
  onNavigate,
  onEdit,
  onAdd,
}: {
  schema: ContextEntrySchema;
  entry: ContextEntry | null;
  onNavigate: (id: string) => void;
  onEdit: (entry: ContextEntry) => void;
  onAdd: () => void;
}) {
  const Icon = ROLE_ICONS[schema.anchor_role] || AlertCircle;
  const hasContent = entry && Object.keys(entry.data).length > 0;

  return (
    <Card
      className={`group flex flex-col h-full transition-all ${
        hasContent
          ? 'cursor-pointer hover:shadow-md hover:border-primary/30'
          : 'border-dashed'
      }`}
      onClick={() => hasContent && entry && onNavigate(entry.id)}
    >
      {/* Header */}
      <div className="flex items-start gap-3 p-4 pb-2">
        <div
          className={`p-2.5 rounded-lg shrink-0 ${
            hasContent ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium leading-tight">{schema.display_name}</h4>
          {entry && (
            <div className="mt-1">
              <SourceBadge entry={entry} />
            </div>
          )}
        </div>
        {hasContent && entry && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(entry);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Content preview */}
      <div className="flex-1 px-4 pb-4">
        {hasContent && entry ? (
          <div className="space-y-2">
            {/* Show first few fields */}
            {getFieldPreviews(entry.data, schema.field_schema.fields).map((preview, idx) => (
              <div key={idx}>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">
                  {preview.label}
                </p>
                {preview.type === 'array' ? (
                  <div className="flex flex-wrap gap-1">
                    {(preview.value as string[]).slice(0, 3).map((item, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {item}
                      </Badge>
                    ))}
                    {(preview.value as string[]).length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{(preview.value as string[]).length - 3}
                      </Badge>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-foreground line-clamp-2">
                    {preview.value as string}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center py-4">
            <p className="text-sm text-muted-foreground text-center mb-3">
              {schema.description}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onAdd();
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        )}
      </div>

      {/* Footer with timestamp */}
      {hasContent && entry && (
        <div className="px-4 py-2 border-t border-border/50 bg-muted/30">
          <p className="text-xs text-muted-foreground">
            Updated {formatRelativeDate(entry.updated_at)}
          </p>
        </div>
      )}
    </Card>
  );
}

/**
 * Agent insight card for grid view
 */
function AgentInsightCard({
  entry,
  onNavigate,
}: {
  entry: ContextEntry;
  onNavigate: (id: string) => void;
}) {
  const Icon = ROLE_ICONS[entry.anchor_role] || Sparkles;
  const typeLabel = ITEM_TYPE_LABELS[entry.anchor_role] || entry.anchor_role;
  const tierConfig = TIER_CONFIG[entry.tier || 'working'];

  const sourceRef = entry.source_ref as { agent_type?: string } | null;
  const agentType = sourceRef?.agent_type;

  return (
    <Card
      className="flex flex-col h-full cursor-pointer hover:shadow-md transition-all border-purple-500/20 bg-purple-500/5 hover:border-purple-500/40"
      onClick={() => onNavigate(entry.id)}
    >
      {/* Header */}
      <div className="flex items-start gap-3 p-4 pb-2">
        <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-600 shrink-0">
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium leading-tight">{entry.display_name || typeLabel}</h4>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Badge variant="outline" className={`text-xs ${tierConfig.bgColor} ${tierConfig.color}`}>
              {tierConfig.label}
            </Badge>
            <Badge variant="secondary" className="text-xs gap-1">
              <Bot className="h-3 w-3" />
              {agentType || 'Agent'}
            </Badge>
          </div>
        </div>
      </div>

      {/* Content preview */}
      <div className="flex-1 px-4 pb-4">
        <p className="text-sm text-foreground line-clamp-4">
          {getContentPreview(entry.data, 200)}
        </p>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-purple-500/20 bg-purple-500/5">
        <p className="text-xs text-muted-foreground">
          Generated {formatRelativeDate(entry.created_at)}
        </p>
      </div>
    </Card>
  );
}

// =============================================================================
// SHARED COMPONENTS
// =============================================================================

/**
 * Badge showing source (user or agent)
 */
function SourceBadge({ entry }: { entry: ContextEntry }) {
  const updatedBy = entry.updated_by || entry.created_by;
  if (!updatedBy) return null;

  const isAgent = updatedBy.startsWith('agent:');
  const agentType = isAgent ? updatedBy.replace('agent:', '') : null;

  return (
    <Badge variant="outline" className="text-xs gap-1 font-normal">
      {isAgent ? (
        <>
          <Bot className="h-3 w-3" />
          <span>{agentType || 'Agent'}</span>
        </>
      ) : (
        <>
          <User className="h-3 w-3" />
          <span>You</span>
        </>
      )}
    </Badge>
  );
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Get a text preview from entry data
 */
function getContentPreview(data: Record<string, unknown>, maxLength: number): string {
  // Try common field names in order of preference
  const preferredFields = ['summary', 'description', 'statement', 'overview', 'content', 'body'];

  for (const field of preferredFields) {
    const value = data[field];
    if (typeof value === 'string' && value.length > 0) {
      return value.length > maxLength ? value.slice(0, maxLength) + '...' : value;
    }
  }

  // Fallback to first string field
  for (const value of Object.values(data)) {
    if (typeof value === 'string' && value.length > 0) {
      return value.length > maxLength ? value.slice(0, maxLength) + '...' : value;
    }
  }

  return 'No content';
}

/**
 * Get field previews for grid view
 */
function getFieldPreviews(
  data: Record<string, unknown>,
  fields: Array<{ key: string; label: string; type: string }>
): Array<{ label: string; value: string | string[]; type: string }> {
  const previews: Array<{ label: string; value: string | string[]; type: string }> = [];
  const maxFields = 2;

  for (const field of fields) {
    if (previews.length >= maxFields) break;

    const value = data[field.key];
    if (!value) continue;

    if (Array.isArray(value) && value.length > 0) {
      previews.push({
        label: field.label,
        value: value.map(String),
        type: 'array',
      });
    } else if (typeof value === 'string' && value.length > 0) {
      previews.push({
        label: field.label,
        value: value.length > 100 ? value.slice(0, 100) + '...' : value,
        type: 'text',
      });
    }
  }

  return previews;
}

/**
 * Format relative date
 */
function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}
