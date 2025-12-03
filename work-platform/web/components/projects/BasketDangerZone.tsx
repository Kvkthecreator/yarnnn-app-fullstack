'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

interface BasketDangerZoneProps {
  projectId: string;
  projectName: string;
  basketId: string;
  basketStats: {
    blocks: number;
    dumps: number;
    assets: number;
    schedules?: number;
  };
}

type PurgeMode = 'archive_all' | 'redact_dumps';

export function BasketDangerZone({
  projectId,
  projectName,
  basketId,
  basketStats,
}: BasketDangerZoneProps) {
  const [mode, setMode] = useState<PurgeMode>('redact_dumps');
  const [confirmationText, setConfirmationText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    totals?: {
      archivedBlocks: number;
      redactedDumps: number;
      deletedAssets: number;
      deletedSchedules?: number;
    };
  } | null>(null);

  const handlePurge = async () => {
    if (confirmationText !== projectName) {
      alert('Project name does not match. Please type the exact project name.');
      return;
    }

    if (!confirm(
      mode === 'archive_all'
        ? 'This will archive all context blocks, redact all raw dumps, and delete all uploaded assets. This action cannot be undone. Continue?'
        : 'This will redact all raw dumps and delete all uploaded assets while keeping extracted context blocks. Continue?'
    )) {
      return;
    }

    setIsProcessing(true);
    setResult(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/purge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode,
          confirmation_text: confirmationText,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to purge basket data');
      }

      setResult({
        success: true,
        message: data.message || 'Purge completed successfully',
        totals: data.totals,
      });

      setConfirmationText('');

      // Refresh page after 3 seconds to update stats
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    } catch (error) {
      console.error('[Basket Purge] Error:', error);
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to purge basket data',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const isConfirmed = confirmationText === projectName;
  const hasData = basketStats.blocks > 0 || basketStats.dumps > 0 || basketStats.assets > 0 || (basketStats.schedules || 0) > 0;

  return (
    <div className="rounded-2xl border border-surface-danger-border bg-surface-danger/80 p-6 space-y-4 text-sm text-destructive-foreground">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-6 w-6 text-destructive flex-shrink-0 mt-0.5" />
        <div className="flex-1 space-y-4">
          <div>
            <h3 className="font-semibold text-destructive-foreground text-lg">
              Purge Basket Data
            </h3>
            <p className="text-sm text-destructive-foreground/80 mt-1">
              Permanently delete context data for this project. This action cannot be undone.
            </p>
          </div>

          {/* Stats Display */}
          <div className="rounded-xl border border-border bg-card/95 p-4 text-card-foreground">
            <p className="text-sm font-medium mb-2">
              Current basket contents:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• {basketStats.blocks} context block{basketStats.blocks !== 1 ? 's' : ''}</li>
              <li>• {basketStats.dumps} raw dump{basketStats.dumps !== 1 ? 's' : ''}</li>
              <li>• {basketStats.assets} uploaded asset{basketStats.assets !== 1 ? 's' : ''}</li>
              {(basketStats.schedules || 0) > 0 && (
                <li>• {basketStats.schedules} schedule{basketStats.schedules !== 1 ? 's' : ''}</li>
              )}
            </ul>
          </div>

          {/* Mode Selection */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-destructive-foreground">
              Purge Mode
            </label>
            <div className="space-y-2">
              <label
                className={cn(
                  'flex items-start gap-3 rounded-xl border bg-card/90 p-3 text-card-foreground cursor-pointer transition-colors',
                  mode === 'redact_dumps'
                    ? 'border-primary ring-1 ring-primary/40'
                    : 'border-border hover:border-border/80'
                )}
              >
                <input
                  type="radio"
                  name="purge-mode"
                  value="redact_dumps"
                  checked={mode === 'redact_dumps'}
                  onChange={(e) => setMode(e.target.value as PurgeMode)}
                  disabled={isProcessing}
                  className="mt-0.5 accent-primary"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    Redact Source Data Only
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Delete raw dumps and uploaded assets while keeping extracted context blocks (meaning preserved)
                  </p>
                </div>
              </label>

              <label
                className={cn(
                  'flex items-start gap-3 rounded-xl border bg-card/90 p-3 text-card-foreground cursor-pointer transition-colors',
                  mode === 'archive_all'
                    ? 'border-primary ring-1 ring-primary/40'
                    : 'border-border hover:border-border/80'
                )}
              >
                <input
                  type="radio"
                  name="purge-mode"
                  value="archive_all"
                  checked={mode === 'archive_all'}
                  onChange={(e) => setMode(e.target.value as PurgeMode)}
                  disabled={isProcessing}
                  className="mt-0.5 accent-primary"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    Full Purge
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Archive all context blocks, redact raw dumps, and delete uploaded assets (complete removal)
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Confirmation Input */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-destructive-foreground">
              Type project name to confirm: <span className="font-mono">{projectName}</span>
            </label>
            <Input
              type="text"
              value={confirmationText}
              onChange={(e) => setConfirmationText(e.target.value)}
              placeholder={projectName}
              disabled={isProcessing || !hasData}
              className="font-mono"
            />
          </div>

          {/* Action Button */}
          <Button
            onClick={handlePurge}
            disabled={!isConfirmed || isProcessing || !hasData}
            variant="destructive"
            className="w-full"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Purging...
              </>
            ) : (
              `Purge Basket (${mode === 'archive_all' ? 'Full Purge' : 'Redact Source Data'})`
            )}
          </Button>

          {!hasData && (
            <p className="text-xs text-destructive-foreground/80 text-center">
              No data to purge. Basket is already empty.
            </p>
          )}

          {/* Result Display */}
          {result && (
            <div
              className={cn(
                'rounded-xl border p-4',
                result.success
                  ? 'border-surface-success-border bg-surface-success text-success-foreground'
                  : 'border-surface-danger-border bg-surface-danger text-destructive-foreground'
              )}
            >
              <p className="text-sm font-medium">
                {result.message}
              </p>
              {result.success && result.totals && (
                <ul className="text-xs mt-2 space-y-1">
                  {result.totals.archivedBlocks > 0 && (
                    <li>• Archived {result.totals.archivedBlocks} blocks</li>
                  )}
                  {result.totals.redactedDumps > 0 && (
                    <li>• Redacted {result.totals.redactedDumps} dumps</li>
                  )}
                  {result.totals.deletedAssets > 0 && (
                    <li>• Deleted {result.totals.deletedAssets} assets</li>
                  )}
                  {(result.totals.deletedSchedules || 0) > 0 && (
                    <li>• Deleted {result.totals.deletedSchedules} schedules</li>
                  )}
                </ul>
              )}
              {result.success && (
                <p className="text-xs mt-2 opacity-80">Page will refresh automatically...</p>
              )}
            </div>
          )}

          {/* Warning Footer */}
          <div className="text-xs text-destructive-foreground space-y-1">
            <p className="font-medium">⚠️ This action is permanent and cannot be undone.</p>
            <p>Governance proposals related to this basket will remain visible for audit purposes.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
