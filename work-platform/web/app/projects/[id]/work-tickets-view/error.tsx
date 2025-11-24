'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams();
  const projectId = params?.id as string;

  useEffect(() => {
    console.error('[Work Sessions List Error]', error);
  }, [error]);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="max-w-lg p-8">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="rounded-full border border-surface-danger-border bg-surface-danger p-4">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>

          <div>
            <h2 className="text-2xl font-bold text-foreground">
              Failed to load work sessions
            </h2>
            <p className="mt-2 text-muted-foreground">
              We encountered an error while loading the work sessions for this project. This could
              be due to a network issue or a problem with the project data.
            </p>
          </div>

          {error.message && (
            <div className="w-full rounded-lg border border-border bg-muted p-3 text-left">
              <p className="text-sm font-mono text-foreground/90">
                {error.message}
              </p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 w-full mt-2">
            <Button
              onClick={reset}
              className="flex-1 inline-flex items-center justify-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
            <Button
              variant="outline"
              asChild
              className="flex-1"
            >
              <Link
                href={projectId ? `/projects/${projectId}/overview` : '/projects'}
                className="inline-flex items-center justify-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Project
              </Link>
            </Button>
          </div>

          {error.digest && (
            <p className="text-xs text-muted-foreground mt-2">
              Error ID: {error.digest}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
