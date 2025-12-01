"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/AlertDialog';
import { Database, Copy, Loader2, Pencil, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Block {
  id: string;
  title: string;
  content: string;
  semantic_type: string;
  state: string;
  confidence: number | null;
  times_referenced: number | null;
  created_at: string;
  updated_at?: string;
  anchor_role: string | null;
  version?: number | null;
  metadata?: Record<string, any>;
}

interface BlockDetailModalProps {
  blockId: string | null;
  projectId: string;
  basketId: string;
  open: boolean;
  onClose: () => void;
  onEdit?: (block: Block) => void;
  onDeleted?: () => void;
}

export default function BlockDetailModal({
  blockId,
  projectId,
  basketId,
  open,
  onClose,
  onEdit,
  onDeleted,
}: BlockDetailModalProps) {
  const [loading, setLoading] = useState(true);
  const [block, setBlock] = useState<Block | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'content' | 'metadata'>('content');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open && blockId) {
      loadBlock();
    }
  }, [open, blockId]);

  const loadBlock = async () => {
    if (!blockId) return;

    try {
      setLoading(true);
      setError(null);

      // Fetch block details from the BFF endpoint
      const response = await fetch(`/api/projects/${projectId}/context/${blockId}`);

      if (!response.ok) {
        throw new Error('Failed to load block details');
      }

      const data = await response.json();
      setBlock(data);
    } catch (err) {
      console.error('[Block Detail Modal] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load block');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleDelete = async () => {
    if (!blockId) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/context/${blockId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ detail: 'Failed to delete block' }));
        throw new Error(data.detail || 'Failed to delete block');
      }

      setShowDeleteConfirm(false);
      onClose();
      onDeleted?.();
    } catch (err) {
      console.error('[Block Detail Modal] Delete error:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete block');
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleEditClick = () => {
    if (block) {
      onClose();
      onEdit?.(block);
    }
  };

  // Check if block can be edited/deleted (not LOCKED)
  const canModify = block && block.state !== 'LOCKED';

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatConfidence = (value: number | null) => {
    if (value === null || Number.isNaN(value)) return '—';
    return `${Math.round(value * 100)}%`;
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Loading block details...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-destructive font-medium">Error loading block</p>
          <p className="text-muted-foreground text-sm mt-2">{error}</p>
        </div>
      );
    }

    if (!block) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-muted-foreground">No block data found</p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Title and Type */}
        <section className="space-y-4">
          {block.title && (
            <div>
              <h3 className="text-lg font-semibold text-foreground">{block.title}</h3>
              <div className="flex flex-wrap gap-2 mt-2">
                <Badge variant="outline" className="bg-surface-primary text-foreground border-surface-primary-border">
                  {block.semantic_type}
                </Badge>
                {block.state && (
                  <Badge variant="outline" className="bg-surface-success text-success-foreground border-surface-success-border">
                    {block.state}
                  </Badge>
                )}
                {block.anchor_role && (
                  <Badge variant="outline" className="bg-surface-warning text-warning-foreground border-surface-warning-border">
                    Anchor: {block.anchor_role}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Main Content */}
          <div className="rounded-lg border border-surface-primary-border bg-surface-primary p-4">
            <div className="prose prose-slate prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => <h1 className="text-xl font-bold text-foreground mt-4 mb-3">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-lg font-semibold text-foreground mt-3 mb-2">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-base font-semibold text-foreground mt-2 mb-1">{children}</h3>,
                  p: ({ children }) => <p className="text-sm text-foreground leading-relaxed mb-3">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc list-inside space-y-1 text-foreground mb-3 text-sm">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 text-foreground mb-3 text-sm">{children}</ol>,
                  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-primary bg-surface-primary pl-3 py-2 italic text-muted-foreground my-3 text-sm">
                      {children}
                    </blockquote>
                  ),
                  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                  em: ({ children }) => <em className="italic text-muted-foreground">{children}</em>,
                  code: ({ children }) => <code className="bg-muted text-foreground px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>,
                  pre: ({ children }) => <pre className="bg-muted text-foreground p-3 rounded-lg overflow-x-auto my-3 text-xs">{children}</pre>,
                }}
              >
                {block.content || 'No content available'}
              </ReactMarkdown>
            </div>
          </div>

          {/* Metadata Grid */}
          <div className="grid gap-x-6 gap-y-2 text-sm text-muted-foreground md:grid-cols-2">
            <div>
              <span className="font-medium text-foreground">Confidence:</span> {formatConfidence(block.confidence)}
            </div>
            <div>
              <span className="font-medium text-foreground">Times used:</span> {block.times_referenced ?? 0}
            </div>
            <div>
              <span className="font-medium text-foreground">Version:</span> {block.version ?? 1}
            </div>
            <div>
              <span className="font-medium text-foreground">Created:</span> {formatTimestamp(block.created_at)}
            </div>
            {block.updated_at && (
              <div className="md:col-span-2">
                <span className="font-medium text-foreground">Updated:</span> {formatTimestamp(block.updated_at)}
              </div>
            )}
          </div>
        </section>
      </div>
    );
  };

  const renderMetadata = () => {
    if (loading || !block) {
      return <div className="text-center text-muted-foreground py-8">No metadata available</div>;
    }

    return (
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Block ID</h4>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-muted text-foreground px-2 py-1 rounded flex-1 truncate">
              {block.id}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(block.id)}
              title="Copy block ID"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Basket ID</h4>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-muted text-foreground px-2 py-1 rounded flex-1 truncate">
              {basketId}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(basketId)}
              title="Copy basket ID"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {block.metadata && Object.keys(block.metadata).length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-foreground mb-2">Additional Metadata</h4>
            <pre className="text-xs bg-muted text-foreground p-3 rounded overflow-x-auto">
              {JSON.stringify(block.metadata, null, 2)}
            </pre>
          </div>
        )}

        <div className="rounded-lg border border-surface-primary-border bg-surface-primary p-4 text-sm text-muted-foreground">
          <p>
            This block is part of the substrate context system. Agents use this information when executing work within your project.
          </p>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-2xl w-full max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="p-4 border-b border-surface-primary-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Database className="h-4 w-4 text-primary" />
              <DialogTitle className="text-lg font-medium text-foreground">
                {block ? `Block - ${block.semantic_type}` : 'Block Details'}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-2">
{blockId && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(blockId)}
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                  title="Copy block ID"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span className="text-xs">Copy ID</span>
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="border-b border-surface-primary-border">
          <div className="flex">
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'content'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('content')}
            >
              Content
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'metadata'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('metadata')}
            >
              Metadata
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'content' ? renderContent() : renderMetadata()}
        </div>

        <DialogFooter className="border-t border-surface-primary-border p-4">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              {canModify && onEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEditClick}
                  className="gap-1.5"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              )}
              {canModify && onDeleted && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              )}
              {block?.state === 'LOCKED' && (
                <span className="text-xs text-muted-foreground">
                  Locked blocks cannot be modified
                </span>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Block</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this block? This action will mark it as superseded
              and remove it from active context. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Block'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
