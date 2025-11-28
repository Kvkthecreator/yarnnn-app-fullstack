"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  Anchor,
  Target,
  Users,
  Lightbulb,
  Puzzle,
  AlertTriangle,
  TrendingUp,
  Eye,
  CheckCircle2,
  Circle,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { AnchorStatusSummary, AnchorLifecycleStatus } from "@/lib/anchors/types";

// Anchor role metadata for display
const ANCHOR_ROLE_CONFIG: Record<string, {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}> = {
  problem: {
    label: "Problem",
    description: "What pain point is being solved",
    icon: AlertTriangle,
    color: "text-red-500",
  },
  customer: {
    label: "Customer",
    description: "Who is this for",
    icon: Users,
    color: "text-blue-500",
  },
  solution: {
    label: "Solution",
    description: "How is it solved",
    icon: Lightbulb,
    color: "text-yellow-500",
  },
  vision: {
    label: "Vision",
    description: "Where is this going",
    icon: Eye,
    color: "text-purple-500",
  },
  feature: {
    label: "Feature",
    description: "Key capabilities",
    icon: Puzzle,
    color: "text-green-500",
  },
  constraint: {
    label: "Constraint",
    description: "Limitations and requirements",
    icon: Target,
    color: "text-orange-500",
  },
  metric: {
    label: "Metric",
    description: "Success measures",
    icon: TrendingUp,
    color: "text-cyan-500",
  },
  insight: {
    label: "Insight",
    description: "Key learnings",
    icon: Sparkles,
    color: "text-pink-500",
  },
};

// Core anchors that every project should ideally have
const CORE_ANCHOR_ROLES = ["problem", "customer", "vision"];

interface AnchorStatusSectionProps {
  projectId: string;
  basketId: string;
  onSeedSuccess?: () => void;
}

export default function AnchorStatusSection({
  projectId,
  basketId,
  onSeedSuccess,
}: AnchorStatusSectionProps) {
  const [anchors, setAnchors] = useState<AnchorStatusSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  // Fetch anchor status
  const fetchAnchors = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${projectId}/context/anchors`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(errorData.detail || `Failed to fetch anchors (${response.status})`);
      }

      const data = await response.json();
      setAnchors(data.anchors || []);
      setError(null);
    } catch (err) {
      console.error("[AnchorStatusSection] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load anchors");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnchors();
  }, [projectId, basketId]);

  // Group anchors by status
  const approvedAnchors = anchors.filter(a => a.lifecycle === 'approved');
  const missingCoreAnchors = CORE_ANCHOR_ROLES.filter(
    role => !anchors.some(a => a.anchor_key === role && a.lifecycle === 'approved')
  );

  // Check if basket needs seeding
  const needsSeeding = anchors.length === 0 || missingCoreAnchors.length >= 2;

  // Get lifecycle badge
  const getLifecycleBadge = (lifecycle: AnchorLifecycleStatus) => {
    switch (lifecycle) {
      case 'approved':
        return (
          <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/30">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Active
          </Badge>
        );
      case 'draft':
        return (
          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 border-yellow-500/30">
            <Circle className="h-3 w-3 mr-1" />
            Draft
          </Badge>
        );
      case 'stale':
        return (
          <Badge variant="outline" className="bg-orange-500/10 text-orange-700 border-orange-500/30">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Stale
          </Badge>
        );
      case 'missing':
        return (
          <Badge variant="outline" className="bg-gray-500/10 text-gray-500 border-gray-500/30">
            <Circle className="h-3 w-3 mr-1" />
            Missing
          </Badge>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading anchor status...</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4 border-destructive/50">
        <div className="flex items-center gap-3 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm">{error}</span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-surface-primary/70 p-2 text-primary">
            <Anchor className="h-5 w-5" />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-foreground">Foundational Anchors</h3>
            <p className="text-xs text-muted-foreground">
              {approvedAnchors.length} active anchors
              {missingCoreAnchors.length > 0 && ` \u2022 ${missingCoreAnchors.length} core missing`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {needsSeeding && (
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 border-yellow-500/30">
              Needs Setup
            </Badge>
          )}
          {expanded ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Content */}
      {expanded && (
        <div className="p-4 space-y-4">
          {/* Empty state with seeding prompt */}
          {anchors.length === 0 ? (
            <div className="text-center py-6">
              <Anchor className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground font-medium mb-2">
                No foundational anchors yet
              </p>
              <p className="text-muted-foreground/80 text-sm mb-4">
                Anchors help agents understand what matters most in your project.
                Describe your project to automatically generate foundational context.
              </p>
              <Button
                variant="default"
                className="gap-2"
                onClick={() => {
                  // Navigate to project settings or trigger seed modal
                  window.location.href = `/projects/${projectId}/settings?seed=true`;
                }}
              >
                <Sparkles className="h-4 w-4" />
                Seed Anchors
              </Button>
            </div>
          ) : (
            <>
              {/* Anchor grid */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {/* Show existing anchors */}
                {anchors.map((anchor) => {
                  const config = ANCHOR_ROLE_CONFIG[anchor.anchor_key] || {
                    label: anchor.label,
                    description: anchor.description || "",
                    icon: Anchor,
                    color: "text-muted-foreground",
                  };
                  const IconComponent = config.icon;

                  return (
                    <div
                      key={anchor.registry_id}
                      className={cn(
                        "p-3 rounded-lg border transition-all",
                        anchor.lifecycle === 'approved'
                          ? "bg-card hover:border-ring"
                          : "bg-muted/30 border-dashed"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn("p-1.5 rounded-md bg-muted/60", config.color)}>
                          <IconComponent className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-medium text-sm text-foreground truncate">
                              {config.label}
                            </span>
                            {getLifecycleBadge(anchor.lifecycle)}
                          </div>
                          {anchor.linked_substrate ? (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {anchor.linked_substrate.title}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">
                              {config.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Show missing core anchors as placeholders */}
                {missingCoreAnchors.map((role) => {
                  const config = ANCHOR_ROLE_CONFIG[role];
                  if (!config) return null;
                  const IconComponent = config.icon;

                  return (
                    <div
                      key={`missing-${role}`}
                      className="p-3 rounded-lg border border-dashed bg-muted/20 opacity-60"
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn("p-1.5 rounded-md bg-muted/60", config.color)}>
                          <IconComponent className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-medium text-sm text-foreground truncate">
                              {config.label}
                            </span>
                            <Badge variant="outline" className="text-[10px] bg-muted/50 text-muted-foreground border-muted">
                              Suggested
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground italic">
                            {config.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Seeding prompt if missing core anchors */}
              {missingCoreAnchors.length > 0 && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
                  <div className="flex items-center gap-2 text-sm text-yellow-700">
                    <Sparkles className="h-4 w-4" />
                    <span>
                      Add context about your project to generate missing anchors
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 border-yellow-500/30 text-yellow-700 hover:bg-yellow-500/10"
                    onClick={() => {
                      window.location.href = `/projects/${projectId}/settings?seed=true`;
                    }}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Seed Anchors
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
