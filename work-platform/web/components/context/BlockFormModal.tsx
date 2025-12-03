"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Label } from '@/components/ui/Label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

// Semantic type options for blocks
const SEMANTIC_TYPE_OPTIONS = [
  { value: 'fact', label: 'Fact', description: 'Verified information or data point' },
  { value: 'intent', label: 'Intent', description: 'Goal or objective statement' },
  { value: 'metric', label: 'Metric', description: 'Measurable indicator or KPI' },
  { value: 'insight', label: 'Insight', description: 'Key learning or discovery' },
  { value: 'context', label: 'Context', description: 'Background information' },
  { value: 'constraint', label: 'Constraint', description: 'Limitation or requirement' },
  { value: 'assumption', label: 'Assumption', description: 'Working hypothesis' },
  { value: 'principle', label: 'Principle', description: 'Guiding rule or value' },
  { value: 'rationale', label: 'Rationale', description: 'Reasoning or justification' },
  { value: 'objective', label: 'Objective', description: 'Specific target or goal' },
];

// Anchor role options - must match blocks_anchor_role_check constraint in DB
// Foundation roles: problem, customer, vision
// Insight roles: trend_digest, competitor_snapshot, market_signal, brand_voice, strategic_direction, customer_insight
// Other: solution, feature, constraint, metric, insight
const ANCHOR_ROLE_OPTIONS = [
  { value: '', label: 'None', description: 'Regular block (not anchored)', category: 'none' },
  // Foundation roles (core project definition)
  { value: 'problem', label: 'Problem', description: 'Core pain point being solved', category: 'foundation' },
  { value: 'customer', label: 'Customer', description: 'Target user or audience', category: 'foundation' },
  { value: 'vision', label: 'Vision', description: 'Why this project exists', category: 'foundation' },
  // Other structural roles
  { value: 'solution', label: 'Solution', description: 'How the problem is solved', category: 'structure' },
  { value: 'feature', label: 'Feature', description: 'Key capability', category: 'structure' },
  { value: 'constraint', label: 'Constraint', description: 'Hard limitation', category: 'structure' },
  { value: 'metric', label: 'Metric', description: 'Success measure', category: 'structure' },
  { value: 'insight', label: 'Insight', description: 'Key learning or discovery', category: 'structure' },
  // Insight roles (agent-producible, refreshable)
  { value: 'trend_digest', label: 'Trend Digest', description: 'Industry trends and market movements', category: 'insight' },
  { value: 'competitor_snapshot', label: 'Competitor Snapshot', description: 'Competitive intelligence', category: 'insight' },
  { value: 'market_signal', label: 'Market Signal', description: 'Research and market insights', category: 'insight' },
  { value: 'brand_voice', label: 'Brand Voice', description: 'Tone and style guidelines', category: 'insight' },
  { value: 'strategic_direction', label: 'Strategic Direction', description: 'Strategic goals and priorities', category: 'insight' },
  { value: 'customer_insight', label: 'Customer Insight', description: 'Deep customer understanding', category: 'insight' },
];

interface Block {
  id: string;
  title: string;
  content: string;
  semantic_type: string;
  state: string;
  anchor_role: string | null;
  metadata?: Record<string, any>;
}

interface BlockFormModalProps {
  projectId: string;
  basketId: string;
  block?: Block | null; // If provided, we're in edit mode
  defaultAnchorRole?: string | null; // Pre-select anchor role for new blocks
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function BlockFormModal({
  projectId,
  basketId,
  block,
  defaultAnchorRole,
  open,
  onClose,
  onSuccess,
}: BlockFormModalProps) {
  const isEditMode = !!block;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [semanticType, setSemanticType] = useState('fact');
  const [anchorRole, setAnchorRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens/closes or block changes
  useEffect(() => {
    if (open) {
      if (block) {
        setTitle(block.title);
        setContent(block.content);
        setSemanticType(block.semantic_type);
        setAnchorRole(block.anchor_role || '');
      } else {
        setTitle('');
        setContent('');
        setSemanticType('fact');
        // Use defaultAnchorRole if provided (e.g., from ?add=problem query param)
        setAnchorRole(defaultAnchorRole || '');
      }
      setError(null);
    }
  }, [open, block, defaultAnchorRole]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!content.trim()) {
      setError('Content is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const url = isEditMode
        ? `/api/projects/${projectId}/context/${block.id}`
        : `/api/projects/${projectId}/context/blocks`;

      const method = isEditMode ? 'PUT' : 'POST';

      const payload: Record<string, any> = {
        title: title.trim(),
        content: content.trim(),
        semantic_type: semanticType,
      };

      // Include anchor_role (empty string removes it in edit mode)
      if (isEditMode) {
        // For updates, always send anchor_role to allow removal
        payload.anchor_role = anchorRole || null;
      } else if (anchorRole) {
        // For creates, only send if set
        payload.anchor_role = anchorRole;
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ detail: 'Failed to save block' }));
        throw new Error(data.detail || 'Failed to save block');
      }

      onSuccess();
      onClose();
    } catch (err) {
      console.error('[BlockFormModal] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to save block');
    } finally {
      setSaving(false);
    }
  };

  // Don't render when closed to ensure complete cleanup
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-lg w-full">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Edit Block' : 'Create Block'}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update the block content. Changes will be reflected in agent context.'
              : 'Add a new knowledge block to your project context.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="block-title">Title</Label>
            <Input
              id="block-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter a descriptive title..."
              disabled={saving}
            />
          </div>

          {/* Semantic Type */}
          <div className="space-y-2">
            <Label htmlFor="block-type">Type</Label>
            <select
              id="block-type"
              value={semanticType}
              onChange={(e) => setSemanticType(e.target.value)}
              disabled={saving}
              className="w-full p-2.5 rounded-lg border border-input bg-input text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              {SEMANTIC_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} - {opt.description}
                </option>
              ))}
            </select>
          </div>

          {/* Anchor Role */}
          <div className="space-y-2">
            <Label htmlFor="block-anchor">Anchor Role (Optional)</Label>
            <select
              id="block-anchor"
              value={anchorRole}
              onChange={(e) => setAnchorRole(e.target.value)}
              disabled={saving}
              className="w-full p-2.5 rounded-lg border border-input bg-input text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              {ANCHOR_ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} - {opt.description}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Anchor blocks are foundational context that agents prioritize.
            </p>
          </div>

          {/* Content */}
          <div className="space-y-2">
            <Label htmlFor="block-content">Content</Label>
            <Textarea
              id="block-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter the block content... (Markdown supported)"
              rows={6}
              disabled={saving}
              className="resize-y min-h-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              Markdown formatting is supported for rich content.
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isEditMode ? 'Saving...' : 'Creating...'}
                </>
              ) : (
                isEditMode ? 'Save Changes' : 'Create Block'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
