"use client";

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { FileText } from 'lucide-react';
import { notificationService } from '@/lib/notifications/service';

interface CreateContextItemModalProps {
  basketId: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialKind?: 'entity' | 'topic' | 'intent' | 'source_ref' | 'cue' | 'task';
  variant?: 'default' | 'onboarding';
}

export default function CreateContextItemModal({ basketId, open, onClose, onSuccess, initialKind = 'entity', variant = 'default' }: CreateContextItemModalProps) {
  const [label, setLabel] = useState('');
  const [content, setContent] = useState('');
  const [synonyms, setSynonyms] = useState('');
  const [kind, setKind] = useState<'entity' | 'topic' | 'intent' | 'source_ref' | 'cue' | 'task'>(initialKind);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!label.trim()) {
      notificationService.notify({
        type: 'substrate.context_item.rejected',
        title: 'Validation Error',
        message: 'Please describe the meaning you want to add',
        severity: 'error'
      });
      return;
    }

    setLoading(true);
    
    try {
      // Route through universal work (governance-aware)
      const response = await fetch('/api/work', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_type: 'MANUAL_EDIT',
          work_payload: {
            basket_id: basketId,
            operations: [{
              type: 'CreateContextItem',
              data: {
                label: label.trim(),
                content: content.trim() || undefined,
                synonyms: synonyms.trim() ? synonyms.split(',').map(s => s.trim()).filter(Boolean) : [],
                kind,
                confidence: 0.9
              }
            }]
          },
          priority: 'normal'
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create context item');
      }

      const result = await response.json();
      
      if (result.execution_mode === 'auto_execute') {
        notificationService.substrateApproved(
          'Meaning Added',
          'New context item created successfully',
          result.created_ids,
          basketId
        );
      } else {
        notificationService.approvalRequired(
          'Meaning Pending Review',
          'Your context item is awaiting approval',
          basketId
        );
      }

      // Reset form
      setLabel('');
      setContent('');
      setSynonyms('');
      setKind('entity');
      onClose();
      onSuccess?.();

    } catch (error) {
      console.error('Meaning addition failed:', error);
      notificationService.substrateRejected(
        'Failed to Add Meaning',
        error instanceof Error ? error.message : 'Failed to add meaning',
        [],
        basketId
      );
    } finally {
      setLoading(false);
    }
  };

  const labelPlaceholder = variant === 'onboarding'
    ? "What’s your current focus?"
    : "e.g., Important Project, Customer Insight, Technical Issue";
  const contentPlaceholder = variant === 'onboarding'
    ? "Why this matters, or how you’ll know it’s done"
    : "Explain why this is important or how it connects to other ideas...";
  const synonymsPlaceholder = variant === 'onboarding'
    ? "Other ways you refer to this (comma separated)"
    : "Other ways to say this, comma-separated";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-xl">🏷️</span>
            {variant === 'onboarding' ? 'Set Your Focus' : 'Add Meaning'}
          </DialogTitle>
        </DialogHeader>
        
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="label">What meaning would you like to add? *</Label>
              <Input
                id="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={labelPlaceholder}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">Why is this meaningful?</Label>
              <Textarea
                id="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={contentPlaceholder}
                rows={3}
                className="resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="kind">Type of meaning</Label>
                <select
                  id="kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                >
                  <option value="entity">Person/Organization</option>
                  <option value="topic">Topic/Theme</option>
                  <option value="intent">Goal/Intent</option>
                  <option value="source_ref">Source Reference</option>
                  <option value="cue">Key Phrase/Concept</option>
                  <option value="task">Task/Action</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="synonyms">Related terms</Label>
                <Input
                  id="synonyms"
                  value={synonyms}
                  onChange={(e) => setSynonyms(e.target.value)}
                  placeholder={synonymsPlaceholder}
                />
              </div>
            </div>

            {variant === 'onboarding' ? (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <div className="text-sm text-purple-800">
                  This helps me prioritize your notes and suggestions.
                </div>
              </div>
            ) : (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="text-sm text-blue-800">
                  <strong>Note:</strong> Your meaning will be added immediately or may need approval depending on your workspace settings.
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={loading}>
                {loading ? 'Adding...' : 'Add Meaning'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
