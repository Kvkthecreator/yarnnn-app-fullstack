"use client";

/**
 * ContextItemDetailClient - Inline editing context item page
 *
 * Architecture (Phase 2 Refactor):
 * - NO modals - all editing happens inline on this page
 * - Simple form layout following schema field order
 * - Edit mode: form fields for input
 * - View mode: clean display of values
 * - Delete functionality here
 *
 * Design Philosophy:
 * - Page IS the editor (no modal layer)
 * - Schema-driven field order (not content-based sizing)
 * - Always show all fields so user knows what's available
 * - Clear provenance tracking
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Label } from '@/components/ui/Label';
import {
  Pencil,
  User,
  Bot,
  Calendar,
  Clock,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  List,
  Type,
  AlignLeft,
  Paperclip,
  History,
  AlertTriangle,
  Users,
  Eye,
  Palette,
  Target,
  TrendingUp,
  BarChart3,
  Lightbulb,
  CheckCircle,
  X,
  Save,
  Loader2,
  Trash2,
  Plus,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

// =============================================================================
// TYPES
// =============================================================================

interface ContextItem {
  id: string;
  basket_id: string;
  item_type: string;
  title: string | null;
  content: Record<string, unknown>;
  tier: 'foundation' | 'working' | 'ephemeral';
  schema_id: string | null;
  source_type: string | null;
  source_ref: Record<string, unknown> | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

type FieldType = 'text' | 'longtext' | 'array' | 'asset' | 'url';

interface FieldDefinition {
  key: string;
  type: FieldType;
  label: string;
  required?: boolean;
  placeholder?: string;
  help?: string;
  accept?: string;
}

interface Schema {
  id: string;
  anchor_role: string;
  display_name: string;
  description: string;
  icon: string;
  category: 'foundation' | 'market' | 'insight';
  is_singleton: boolean;
  field_schema: {
    fields: FieldDefinition[];
    agent_produced?: boolean;
  };
}

// =============================================================================
// CONSTANTS
// =============================================================================

const ITEM_TYPE_ICONS: Record<string, React.ElementType> = {
  problem: AlertTriangle,
  customer: Users,
  vision: Eye,
  brand: Palette,
  competitor: Target,
  trend_digest: TrendingUp,
  market_intel: Lightbulb,
  competitor_snapshot: BarChart3,
};

const TIER_CONFIG: Record<string, { label: string; color: string; bgColor: string; description: string }> = {
  foundation: {
    label: 'Foundation',
    color: 'text-blue-700',
    bgColor: 'bg-blue-500/10 border-blue-500/30',
    description: 'Core context that defines your project',
  },
  working: {
    label: 'Working',
    color: 'text-purple-700',
    bgColor: 'bg-purple-500/10 border-purple-500/30',
    description: 'Active context being refined',
  },
  ephemeral: {
    label: 'Ephemeral',
    color: 'text-gray-600',
    bgColor: 'bg-gray-500/10 border-gray-500/30',
    description: 'Temporary context that may expire',
  },
};

const FIELD_TYPE_ICONS: Record<string, React.ElementType> = {
  text: Type,
  longtext: AlignLeft,
  array: List,
  asset: Paperclip,
  url: LinkIcon,
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

interface ContextItemDetailClientProps {
  projectId: string;
  basketId: string;
  item: ContextItem | null;  // null for new items
  schema: Schema | null;
  isNew?: boolean;
  schemaRole?: string;  // For new items, which schema to use
}

export default function ContextItemDetailClient({
  projectId,
  basketId,
  item,
  schema,
  isNew = false,
  schemaRole,
}: ContextItemDetailClientProps) {
  const router = useRouter();

  // Edit mode state
  const [isEditing, setIsEditing] = useState(isNew);
  const [formData, setFormData] = useState<Record<string, unknown>>(item?.content || {});
  const [displayName, setDisplayName] = useState(item?.title || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize form data for new items
  useEffect(() => {
    if (isNew && schema) {
      const initialData: Record<string, unknown> = {};
      schema.field_schema.fields.forEach((field) => {
        if (field.type === 'array') {
          initialData[field.key] = [];
        } else if (field.type === 'asset') {
          initialData[field.key] = null;
        } else {
          initialData[field.key] = '';
        }
      });
      setFormData(initialData);
    }
  }, [isNew, schema]);

  const Icon = ITEM_TYPE_ICONS[item?.item_type || schemaRole || ''] || FileText;
  const tierConfig = TIER_CONFIG[item?.tier || 'foundation'];

  // Parse source info
  const isAgentGenerated = item?.source_type === 'agent';
  const sourceRef = item?.source_ref as { work_ticket_id?: string; agent_type?: string } | null;

  // Get fields from schema or infer from content
  const fields = useMemo(() => {
    if (schema?.field_schema?.fields) {
      return schema.field_schema.fields;
    }
    if (item?.content) {
      return Object.keys(item.content).map((key): FieldDefinition => ({
        key,
        type: inferFieldType(item.content[key]),
        label: formatLabel(key),
        required: false,
      }));
    }
    return [];
  }, [schema, item?.content]);

  // Categorize fields for layout - group short fields together
  const { primaryFields, secondaryFields } = useMemo(() => {
    const primary: FieldDefinition[] = [];
    const secondary: FieldDefinition[] = [];

    fields.forEach((field) => {
      // Primary: longtext, array, asset fields get full width
      if (field.type === 'longtext' || field.type === 'array' || field.type === 'asset') {
        primary.push(field);
      } else {
        // Secondary: short text fields can be grouped
        secondary.push(field);
      }
    });

    return { primaryFields: primary, secondaryFields: secondary };
  }, [fields]);

  // Track changes
  const updateField = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  }, []);

  // Calculate completeness
  const completeness = useMemo(() => {
    const requiredFields = fields.filter((f) => f.required);
    if (requiredFields.length === 0) return 1;

    const data = isEditing ? formData : (item?.content || {});
    let filled = 0;
    requiredFields.forEach((field) => {
      const value = data[field.key];
      if (field.type === 'array') {
        if (Array.isArray(value) && value.length > 0) filled++;
      } else if (value && String(value).trim()) {
        filled++;
      }
    });

    return filled / requiredFields.length;
  }, [fields, formData, item?.content, isEditing]);

  // Save handler
  const handleSave = async () => {
    if (!schema) return;

    // Validate required fields
    for (const field of fields) {
      if (field.required) {
        const value = formData[field.key];
        const isEmpty = field.type === 'array'
          ? !Array.isArray(value) || value.length === 0
          : !value || !String(value).trim();
        if (isEmpty) {
          toast.error(`${field.label} is required`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      const url = `/api/substrate/baskets/${basketId}/context/entries/${schema.anchor_role}`;
      const payload: Record<string, unknown> = { data: formData };

      if (!schema.is_singleton && displayName.trim()) {
        payload.display_name = displayName.trim();
      }

      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ detail: 'Failed to save' }));
        throw new Error(data.detail || 'Failed to save');
      }

      const result = await response.json();

      toast.success(isNew ? 'Context created' : 'Changes saved');
      setHasChanges(false);
      setIsEditing(false);

      // If new, redirect to the created item
      if (isNew && result.id) {
        router.replace(`/projects/${projectId}/context/${result.id}`);
      } else {
        // Refresh to get updated data
        router.refresh();
      }
    } catch (err) {
      console.error('[ContextItemDetail] Save error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Delete handler
  const handleDelete = async () => {
    if (!item || !confirm('Are you sure you want to delete this context item?')) return;

    setDeleting(true);
    try {
      const response = await fetch(
        `/api/substrate/baskets/${basketId}/context/entries/${item.item_type}/${item.id}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error('Failed to delete');
      }

      toast.success('Context deleted');
      router.push(`/projects/${projectId}/context`);
    } catch (err) {
      console.error('[ContextItemDetail] Delete error:', err);
      toast.error('Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  // Cancel editing
  const handleCancel = () => {
    if (isNew) {
      router.push(`/projects/${projectId}/context`);
    } else {
      setFormData(item?.content || {});
      setDisplayName(item?.title || '');
      setHasChanges(false);
      setIsEditing(false);
    }
  };

  // For new items without schema, show error
  if (isNew && !schema) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-12 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
        <h2 className="text-xl font-semibold">Schema not found</h2>
        <p className="text-muted-foreground mt-2">
          Unable to create new context item. Schema &quot;{schemaRole}&quot; not found.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => router.push(`/projects/${projectId}/context`)}>
          Back to Context
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Hero Section */}
      <div className="mb-8">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            {/* Icon */}
            <div className={`p-4 rounded-xl ${tierConfig.bgColor}`}>
              <Icon className={`h-8 w-8 ${tierConfig.color}`} />
            </div>

            {/* Title and Meta */}
            <div className="flex-1">
              {isEditing && schema && !schema.is_singleton ? (
                <Input
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder={`Enter ${schema.display_name.toLowerCase()} name...`}
                  className="text-2xl font-bold h-auto py-1 px-2 -ml-2"
                />
              ) : (
                <h1 className="text-3xl font-bold text-foreground">
                  {item?.title || schema?.display_name || formatLabel(item?.item_type || schemaRole || '')}
                </h1>
              )}
              <p className="text-muted-foreground mt-1">
                {schema?.description || tierConfig.description}
              </p>

              {/* Badges Row */}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <Badge variant="outline" className={`${tierConfig.bgColor} ${tierConfig.color}`}>
                  {tierConfig.label}
                </Badge>
                {schema?.category && (
                  <Badge variant="secondary" className="capitalize">
                    {schema.category}
                  </Badge>
                )}
                {!isNew && (
                  <Badge variant="outline" className="gap-1">
                    {isAgentGenerated ? (
                      <>
                        <Bot className="h-3 w-3" />
                        {sourceRef?.agent_type || 'Agent'}
                      </>
                    ) : (
                      <>
                        <User className="h-3 w-3" />
                        You
                      </>
                    )}
                  </Badge>
                )}
                <CompletenessIndicator score={completeness} />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Button variant="outline" onClick={handleCancel} disabled={saving}>
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving || (!hasChanges && !isNew)}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  {isNew ? 'Create' : 'Save'}
                </Button>
              </>
            ) : (
              <>
                {item && (
                  <Button variant="outline" onClick={handleDelete} disabled={deleting}>
                    {deleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                )}
                <Button onClick={() => setIsEditing(true)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Fields Layout - Schema order, not content-based sizing */}
      <div className="space-y-6">
        {/* Short text fields - grouped in a row when there are multiple */}
        {secondaryFields.length > 0 && (
          <div className={`grid gap-4 ${secondaryFields.length > 1 ? 'sm:grid-cols-2 lg:grid-cols-3' : ''}`}>
            {secondaryFields.map((field) => (
              <FieldSection
                key={field.key}
                field={field}
                value={isEditing ? formData[field.key] : item?.content[field.key]}
                isEditing={isEditing}
                onChange={(value) => updateField(field.key, value)}
                basketId={basketId}
              />
            ))}
          </div>
        )}

        {/* Primary fields - full width, in schema order */}
        {primaryFields.map((field) => (
          <FieldSection
            key={field.key}
            field={field}
            value={isEditing ? formData[field.key] : item?.content[field.key]}
            isEditing={isEditing}
            onChange={(value) => updateField(field.key, value)}
            basketId={basketId}
          />
        ))}
      </div>

      {/* Provenance Footer - only show for existing items */}
      {!isNew && item && (
        <div className="mt-8 pt-6 border-t border-border">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span>Created {formatDate(item.created_at)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <span>Updated {formatDate(item.updated_at)}</span>
              </div>
            </div>

            {isAgentGenerated && sourceRef?.work_ticket_id && (
              <Link
                href={`/projects/${projectId}/work-tickets/${sourceRef.work_ticket_id}/track`}
                className="text-primary hover:underline flex items-center gap-1"
              >
                View Source Work Ticket
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>

          <div className="mt-4 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <History className="h-4 w-4" />
              <span>Version history coming soon</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// FIELD SECTION COMPONENT
// =============================================================================

function FieldSection({
  field,
  value,
  isEditing,
  onChange,
  basketId,
}: {
  field: FieldDefinition;
  value: unknown;
  isEditing: boolean;
  onChange: (value: unknown) => void;
  basketId: string;
}) {
  const FieldIcon = FIELD_TYPE_ICONS[field.type] || Type;
  const hasValue = value !== undefined && value !== null && value !== '' &&
    !(Array.isArray(value) && value.length === 0);

  return (
    <div className="space-y-2">
      {/* Field Label */}
      <div className="flex items-center gap-2">
        <FieldIcon className="h-4 w-4 text-muted-foreground" />
        <Label className="text-sm font-medium">
          {field.label}
          {field.required && <span className="text-destructive ml-1">*</span>}
        </Label>
      </div>

      {/* Field Content */}
      <div className={`${!isEditing && !hasValue ? 'text-muted-foreground italic text-sm' : ''}`}>
        {isEditing ? (
          <FieldEditor field={field} value={value} onChange={onChange} basketId={basketId} />
        ) : hasValue ? (
          <FieldRenderer field={field} value={value} />
        ) : (
          <span>Not set</span>
        )}
      </div>

      {/* Help text */}
      {isEditing && field.help && (
        <p className="text-xs text-muted-foreground">{field.help}</p>
      )}
    </div>
  );
}

// =============================================================================
// FIELD EDITOR COMPONENT
// =============================================================================

function FieldEditor({
  field,
  value,
  onChange,
  basketId,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  basketId: string;
}) {
  switch (field.type) {
    case 'text':
    case 'url':
      return (
        <Input
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
        />
      );

    case 'longtext':
      return (
        <Textarea
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={6}
          className="resize-y min-h-[150px]"
        />
      );

    case 'array':
      return (
        <ArrayFieldEditor
          values={(value as string[]) || []}
          onChange={onChange}
          placeholder={field.placeholder || `Add ${field.label.toLowerCase()}...`}
        />
      );

    case 'asset':
      return (
        <AssetFieldEditor
          value={(value as string) || null}
          onChange={onChange}
          basketId={basketId}
          accept={field.accept}
          label={field.label}
        />
      );

    default:
      return (
        <Input
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

// =============================================================================
// FIELD RENDERER COMPONENT (View Mode)
// =============================================================================

function FieldRenderer({ field, value }: { field: FieldDefinition; value: unknown }) {
  if (field.type === 'text') {
    return <p className="text-foreground">{String(value)}</p>;
  }

  if (field.type === 'longtext') {
    return (
      <div className="prose prose-sm max-w-none">
        <p className="text-foreground whitespace-pre-wrap leading-relaxed">
          {String(value)}
        </p>
      </div>
    );
  }

  if (field.type === 'array' && Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-2">
        {value.map((item, idx) => (
          <Badge key={idx} variant="secondary" className="text-sm">
            {typeof item === 'object' ? JSON.stringify(item) : String(item)}
          </Badge>
        ))}
      </div>
    );
  }

  if (field.type === 'asset' && typeof value === 'string') {
    if (value.startsWith('asset://')) {
      const assetId = value.replace('asset://', '');
      return (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground font-mono">{assetId.slice(0, 8)}...</span>
        </div>
      );
    }
    if (value.match(/\.(jpg|jpeg|png|gif|webp)/i)) {
      return (
        <div className="relative rounded-lg overflow-hidden bg-muted">
          <img src={value} alt={field.label} className="w-full h-auto max-h-64 object-contain" />
        </div>
      );
    }
  }

  if (field.type === 'url' && typeof value === 'string') {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline flex items-center gap-1"
      >
        <LinkIcon className="h-4 w-4" />
        {value.length > 50 ? value.slice(0, 50) + '...' : value}
        <ExternalLink className="h-3 w-3" />
      </a>
    );
  }

  if (Array.isArray(value)) {
    return (
      <ul className="list-disc list-inside space-y-1">
        {value.slice(0, 10).map((item, idx) => (
          <li key={idx} className="text-sm text-foreground">
            {typeof item === 'object' ? JSON.stringify(item) : String(item)}
          </li>
        ))}
        {value.length > 10 && (
          <li className="text-sm text-muted-foreground">+{value.length - 10} more</li>
        )}
      </ul>
    );
  }

  if (typeof value === 'object' && value !== null) {
    return (
      <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-48">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return <p className="text-foreground">{String(value)}</p>;
}

// =============================================================================
// ARRAY FIELD EDITOR
// =============================================================================

function ArrayFieldEditor({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (values: unknown) => void;
  placeholder?: string;
}) {
  const [newItem, setNewItem] = useState('');

  const addItem = () => {
    if (newItem.trim()) {
      onChange([...values, newItem.trim()]);
      setNewItem('');
    }
  };

  const removeItem = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((item, index) => (
            <Badge key={index} variant="secondary" className="flex items-center gap-1 px-2 py-1">
              <span className="text-sm">{item}</span>
              <button type="button" onClick={() => removeItem(index)} className="ml-1 hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addItem();
            }
          }}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={addItem} disabled={!newItem.trim()}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// ASSET FIELD EDITOR
// =============================================================================

function AssetFieldEditor({
  value,
  onChange,
  basketId,
  accept,
  label,
}: {
  value: string | null;
  onChange: (value: unknown) => void;
  basketId: string;
  accept?: string;
  label: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [assetInfo, setAssetInfo] = useState<{ filename: string } | null>(null);

  useEffect(() => {
    if (value && value.startsWith('asset://')) {
      const assetId = value.replace('asset://', '');
      setAssetInfo({ filename: `Asset: ${assetId.slice(0, 8)}...` });
    } else {
      setAssetInfo(null);
    }
  }, [value]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`/api/baskets/${basketId}/assets/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      onChange(`asset://${data.id}`);
      setAssetInfo({ filename: data.filename || file.name });
      toast.success('Asset uploaded');
    } catch (err) {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = () => {
    onChange(null);
    setAssetInfo(null);
  };

  const isImage = accept?.includes('image');

  return (
    <div className="space-y-2">
      {assetInfo ? (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
          {isImage ? (
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          ) : (
            <FileText className="h-5 w-5 text-muted-foreground" />
          )}
          <span className="flex-1 text-sm truncate">{assetInfo.filename}</span>
          <Button type="button" variant="ghost" size="sm" onClick={handleRemove} className="h-8 w-8 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <>
              <Upload className="h-6 w-6 text-muted-foreground mb-1" />
              <span className="text-sm text-muted-foreground">Click to upload {label.toLowerCase()}</span>
            </>
          )}
          <input
            type="file"
            accept={accept}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
            disabled={uploading}
            className="hidden"
          />
        </label>
      )}
    </div>
  );
}

// =============================================================================
// COMPLETENESS INDICATOR
// =============================================================================

function CompletenessIndicator({ score }: { score: number }) {
  const percentage = Math.round(score * 100);

  return (
    <Badge
      variant="outline"
      className={`gap-1 ${
        percentage === 100
          ? 'bg-green-500/10 text-green-700 border-green-500/30'
          : percentage >= 50
          ? 'bg-yellow-500/10 text-yellow-700 border-yellow-500/30'
          : 'bg-red-500/10 text-red-700 border-red-500/30'
      }`}
    >
      {percentage === 100 ? (
        <CheckCircle className="h-3 w-3" />
      ) : (
        <span className="text-xs">{percentage}%</span>
      )}
      Complete
    </Badge>
  );
}

// =============================================================================
// UTILITIES
// =============================================================================

function inferFieldType(value: unknown): FieldType {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') {
    if (value.startsWith('asset://')) return 'asset';
    if (value.startsWith('http://') || value.startsWith('https://')) return 'url';
    if (value.length > 200) return 'longtext';
  }
  return 'text';
}

function formatLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return `today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } else if (diffDays === 1) {
    return 'yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  }
  return date.toLocaleDateString();
}
