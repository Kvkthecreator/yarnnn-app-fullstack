"use client";

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import {
  Building2,
  Target,
  Users,
  Palette,
  CheckCircle2,
  Circle,
  AlertCircle,
  ChevronRight,
  Loader2,
  Info,
} from 'lucide-react';

interface TemplateField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

interface TemplateSchema {
  fields: TemplateField[];
  outputConfig: {
    semantic_type: string;
    title_template: string;
    state: string;
  };
}

interface Template {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  schema: TemplateSchema;
  is_required: boolean;
  display_order: number;
  icon: string | null;
  // Status
  is_filled: boolean;
  block_id: string | null;
  filled_at: string | null;
}

interface TemplateStatus {
  total: number;
  filled: number;
  required_total: number;
  required_filled: number;
  is_complete: boolean;
}

interface CoreContextSectionProps {
  projectId: string;
  basketId: string;
  onTemplateClick: (template: Template) => void;
}

const ICON_MAP: Record<string, typeof Building2> = {
  Building2,
  Target,
  Users,
  Palette,
};

export default function CoreContextSection({
  projectId,
  basketId,
  onTemplateClick,
}: CoreContextSectionProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [status, setStatus] = useState<TemplateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, [projectId]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${projectId}/context/templates`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(errorData.detail || `Failed to fetch templates (${response.status})`);
      }

      const data = await response.json();
      setTemplates(data.templates || []);
      setStatus(data.status || null);
      setError(null);
    } catch (err) {
      console.error('[CoreContextSection] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const getIconComponent = (iconName: string | null) => {
    if (!iconName || !ICON_MAP[iconName]) {
      return Building2;
    }
    return ICON_MAP[iconName];
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Loading foundational context...</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6 border-destructive/30 bg-destructive/5">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <div>
            <p className="text-sm font-medium text-destructive">Failed to load context templates</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
          </div>
        </div>
      </Card>
    );
  }

  // Separate required and optional templates
  const requiredTemplates = templates.filter((t) => t.is_required);
  const optionalTemplates = templates.filter((t) => !t.is_required);

  const isComplete = status?.is_complete ?? false;
  const requiredFilled = status?.required_filled ?? 0;
  const requiredTotal = status?.required_total ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-foreground">Core Context</h3>
          {isComplete ? (
            <Badge className="bg-surface-success text-success-foreground border-surface-success-border">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Complete
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-surface-warning/50 text-warning-foreground border-surface-warning-border">
              {requiredFilled}/{requiredTotal} required
            </Badge>
          )}
        </div>
      </div>

      {/* Info banner for incomplete state */}
      {!isComplete && (
        <div className="flex items-start gap-3 rounded-lg border border-surface-primary-border bg-surface-primary p-4">
          <Info className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Set up your project's foundational context</p>
            <p>
              Completing these templates helps agents understand your project better, leading to more accurate and relevant outputs.
            </p>
          </div>
        </div>
      )}

      {/* Required Templates */}
      {requiredTemplates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Required</p>
          <div className="grid gap-3 md:grid-cols-2">
            {requiredTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onClick={() => onTemplateClick(template)}
                getIconComponent={getIconComponent}
              />
            ))}
          </div>
        </div>
      )}

      {/* Optional Templates */}
      {optionalTemplates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Optional</p>
          <div className="grid gap-3 md:grid-cols-2">
            {optionalTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onClick={() => onTemplateClick(template)}
                getIconComponent={getIconComponent}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface TemplateCardProps {
  template: Template;
  onClick: () => void;
  getIconComponent: (iconName: string | null) => typeof Building2;
}

function TemplateCard({ template, onClick, getIconComponent }: TemplateCardProps) {
  const IconComponent = getIconComponent(template.icon);

  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex items-center gap-4 rounded-lg border p-4 text-left transition-all',
        'hover:shadow-sm hover:border-primary/30',
        template.is_filled
          ? 'border-surface-success-border bg-surface-success/30'
          : 'border-border bg-background'
      )}
    >
      <div
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0',
          template.is_filled
            ? 'bg-surface-success text-success-foreground'
            : 'bg-muted text-muted-foreground'
        )}
      >
        <IconComponent className="h-5 w-5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{template.name}</span>
          {template.is_filled ? (
            <CheckCircle2 className="h-4 w-4 text-success-foreground flex-shrink-0" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}
        </div>
        {template.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {template.description}
          </p>
        )}
      </div>

      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
    </button>
  );
}
