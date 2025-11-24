import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-5 w-48" />
        </div>
        <Skeleton className="h-10 w-40" />
      </div>

      {/* Status Filter Cards Skeleton */}
      <div className="grid gap-4 md:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-8 w-12" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Sessions List Skeleton */}
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <Card key={i} className="p-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-5 w-full max-w-2xl" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
