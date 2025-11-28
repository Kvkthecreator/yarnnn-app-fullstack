"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import {
  ChevronRight,
  Anchor,
  Sparkles,
} from 'lucide-react';
import type { AnchorStatusSummary } from '@/lib/anchors/types';

// Core anchors that every project should have
const CORE_ANCHOR_ROLES = ['problem', 'customer', 'vision'];

interface AnchorStatus {
  total: number;
  approved: number;
  missing_core: string[];
}

interface SetupContextBannerProps {
  projectId: string;
  basketId: string;
}

export default function SetupContextBanner({
  projectId,
  basketId,
}: SetupContextBannerProps) {
  const router = useRouter();
  const [status, setStatus] = useState<AnchorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchAnchorStatus();
  }, [projectId]);

  const fetchAnchorStatus = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${projectId}/context/anchors`);

      if (response.ok) {
        const data = await response.json();
        const anchors: AnchorStatusSummary[] = data.anchors || [];

        // Calculate status
        const approvedAnchors = anchors.filter(a => a.lifecycle === 'approved');
        const missingCore = CORE_ANCHOR_ROLES.filter(
          role => !anchors.some(a => a.anchor_key === role && a.lifecycle === 'approved')
        );

        setStatus({
          total: anchors.length,
          approved: approvedAnchors.length,
          missing_core: missingCore,
        });
        setError(false);
      } else {
        setError(true);
      }
    } catch (err) {
      console.error('[SetupContextBanner] Error:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  // Don't show banner if loading, error, or complete
  if (loading) {
    return null; // Silent loading
  }

  if (error || !status) {
    return null; // Don't block the page if anchors API fails
  }

  // If all core anchors are present, don't show banner
  if (status.missing_core.length === 0) {
    return null;
  }

  const missingCount = status.missing_core.length;

  return (
    <Card
      className={cn(
        'border-2 border-dashed p-6',
        'border-surface-warning-border bg-surface-warning/20'
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-warning text-warning-foreground flex-shrink-0">
            <Anchor className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">
                Set Up Foundational Context
              </h3>
              <Badge
                variant="outline"
                className="bg-surface-warning/50 text-warning-foreground border-surface-warning-border"
              >
                {CORE_ANCHOR_ROLES.length - missingCount}/{CORE_ANCHOR_ROLES.length} anchors
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {status.total === 0
                ? "Describe your project to automatically generate foundational context anchors."
                : `Add ${missingCount} more anchor${missingCount !== 1 ? 's' : ''} (${status.missing_core.join(', ')}) to help agents understand your project better.`
              }
            </p>
          </div>
        </div>

        <Button
          onClick={() => router.push(`/projects/${projectId}/context`)}
          className="gap-2 flex-shrink-0"
        >
          <Sparkles className="h-4 w-4" />
          Set Up Anchors
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
