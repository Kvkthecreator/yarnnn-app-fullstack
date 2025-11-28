"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Building2,
} from 'lucide-react';

interface TemplateStatus {
  total: number;
  filled: number;
  required_total: number;
  required_filled: number;
  is_complete: boolean;
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
  const [status, setStatus] = useState<TemplateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchTemplateStatus();
  }, [projectId]);

  const fetchTemplateStatus = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${projectId}/context/templates`);

      if (response.ok) {
        const data = await response.json();
        setStatus(data.status || null);
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
    return null; // Don't block the page if templates API fails
  }

  // If all required templates are filled, show a subtle completed state or nothing
  if (status.is_complete) {
    // Optional: Show a subtle "complete" state
    // For now, just don't show the banner when complete
    return null;
  }

  const pendingRequired = status.required_total - status.required_filled;

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
            <Building2 className="h-6 w-6" />
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
                {status.required_filled}/{status.required_total} required
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Complete {pendingRequired} more required template{pendingRequired !== 1 ? 's' : ''} to help agents understand your project better.
              This improves accuracy and relevance of agent outputs.
            </p>
          </div>
        </div>

        <Button
          onClick={() => router.push(`/projects/${projectId}/context`)}
          className="gap-2 flex-shrink-0"
        >
          Set Up Context
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
