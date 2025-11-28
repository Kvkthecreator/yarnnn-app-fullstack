"use client";

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Label } from '@/components/ui/Label';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import {
  Building2,
  Target,
  Users,
  Palette,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
} from 'lucide-react';

interface TemplateField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
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
  is_filled: boolean;
  block_id: string | null;
  filled_at: string | null;
}

interface TemplateFormModalProps {
  template: Template | null;
  projectId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const ICON_MAP: Record<string, typeof Building2> = {
  Building2,
  Target,
  Users,
  Palette,
};

export default function TemplateFormModal({
  template,
  projectId,
  open,
  onClose,
  onSuccess,
}: TemplateFormModalProps) {
  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load existing values if template is already filled
  useEffect(() => {
    if (open && template) {
      if (template.is_filled) {
        loadExistingValues();
      } else {
        // Initialize with empty values
        const initialValues: Record<string, any> = {};
        template.schema.fields.forEach((field) => {
          initialValues[field.key] = '';
        });
        setValues(initialValues);
        setError(null);
        setSuccess(false);
      }
    }
  }, [open, template]);

  const loadExistingValues = async () => {
    if (!template) return;

    try {
      setLoadingExisting(true);
      const response = await fetch(`/api/projects/${projectId}/context/templates/${template.slug}`);

      if (response.ok) {
        const data = await response.json();
        if (data.current_values) {
          setValues(data.current_values);
        }
      }
    } catch (err) {
      console.error('[TemplateFormModal] Error loading existing values:', err);
    } finally {
      setLoadingExisting(false);
    }
  };

  const handleChange = (key: string, value: any) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!template) return;

    // Validate required fields
    const missingRequired: string[] = [];
    template.schema.fields.forEach((field) => {
      if (field.required && !values[field.key]?.toString().trim()) {
        missingRequired.push(field.label);
      }
    });

    if (missingRequired.length > 0) {
      setError(`Please fill in: ${missingRequired.join(', ')}`);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/projects/${projectId}/context/templates/${template.slug}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Failed to save' }));
        throw new Error(errorData.detail || 'Failed to save template');
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
        setSuccess(false);
      }, 1000);
    } catch (err) {
      console.error('[TemplateFormModal] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  const getIconComponent = (iconName: string | null) => {
    if (!iconName || !ICON_MAP[iconName]) {
      return Building2;
    }
    return ICON_MAP[iconName];
  };

  if (!template) return null;

  const IconComponent = getIconComponent(template.icon);
  const fields = template.schema.fields || [];

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-4 border-b border-border">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-lg flex-shrink-0',
                template.is_filled
                  ? 'bg-surface-success text-success-foreground'
                  : 'bg-surface-primary text-primary'
              )}
            >
              <IconComponent className="h-6 w-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl font-semibold text-foreground">
                  {template.name}
                </DialogTitle>
                {template.is_required && (
                  <Badge variant="outline" className="text-xs">Required</Badge>
                )}
              </div>
              {template.description && (
                <DialogDescription className="mt-1 text-sm text-muted-foreground">
                  {template.description}
                </DialogDescription>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={handleClose} disabled={loading}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6">
          {loadingExisting ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading...</span>
            </div>
          ) : (
            <div className="space-y-6">
              {fields.map((field) => (
                <FieldInput
                  key={field.key}
                  field={field}
                  value={values[field.key] || ''}
                  onChange={(value) => handleChange(field.key, value)}
                  disabled={loading}
                />
              ))}
            </div>
          )}

          {error && (
            <div className="mt-6 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="mt-6 flex items-center gap-2 rounded-lg border border-surface-success-border bg-surface-success p-3 text-sm text-success-foreground">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              <span>Saved successfully!</span>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border p-4">
          <Button variant="ghost" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || loadingExisting}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : template.is_filled ? (
              'Update'
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FieldInputProps {
  field: TemplateField;
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
}

function FieldInput({ field, value, onChange, disabled }: FieldInputProps) {
  const isRequired = field.required;

  // Render select for fields with options
  if (field.options && field.options.length > 0) {
    return (
      <div className="space-y-2">
        <Label className={cn(isRequired && "after:content-['*'] after:ml-1 after:text-destructive")}>
          {field.label}
        </Label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          <option value="">Select {field.label.toLowerCase()}...</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Render textarea for long_text type
  if (field.type === 'long_text' || field.type === 'textarea') {
    return (
      <div className="space-y-2">
        <Label className={cn(isRequired && "after:content-['*'] after:ml-1 after:text-destructive")}>
          {field.label}
        </Label>
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
          rows={4}
          className="resize-none"
          maxLength={field.validation?.maxLength}
        />
      </div>
    );
  }

  // Render array input for array type (comma-separated)
  if (field.type === 'array' || field.type === 'list') {
    const arrayValue = Array.isArray(value) ? value.join(', ') : value;
    return (
      <div className="space-y-2">
        <Label className={cn(isRequired && "after:content-['*'] after:ml-1 after:text-destructive")}>
          {field.label}
        </Label>
        <Textarea
          value={arrayValue}
          onChange={(e) => {
            const items = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
            onChange(items);
          }}
          placeholder={field.placeholder || 'Enter items separated by commas'}
          disabled={disabled}
          rows={3}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground">Separate multiple items with commas</p>
      </div>
    );
  }

  // Default: text input
  return (
    <div className="space-y-2">
      <Label className={cn(isRequired && "after:content-['*'] after:ml-1 after:text-destructive")}>
        {field.label}
      </Label>
      <Input
        type={field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        disabled={disabled}
        maxLength={field.validation?.maxLength}
      />
    </div>
  );
}
