"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import {
  FileText,
  Loader2,
  AlertCircle,
  Search,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle,
  XCircle,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { SourceBadge } from "@/components/context/SourceBadge";
import { getOutputTypeLabel, getSupervisionStatusLabel } from "@/lib/types/substrate";
import type { Entry, EntriesListResponse } from "@/lib/types/substrate";
import { cn } from "@/lib/utils";

interface ContextEntriesClientProps {
  projectId: string;
  basketId: string;
}

export default function ContextEntriesClient({
  projectId,
  basketId,
}: ContextEntriesClientProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "user" | "agent">("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState({ total: 0, rawDumps: 0, workOutputs: 0 });

  // Fetch entries
  const fetchEntries = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (sourceFilter !== "all") {
        params.set("source", sourceFilter);
      }

      const response = await fetch(
        `/api/baskets/${basketId}/entries?${params.toString()}`
      );
      if (!response.ok) throw new Error("Failed to fetch entries");

      const data: EntriesListResponse = await response.json();
      setEntries(data.entries || []);
      setCounts({
        total: data.total,
        rawDumps: data.raw_dumps_count,
        workOutputs: data.work_outputs_count,
      });
      setError(null);
    } catch (err) {
      console.error("[Entries] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load entries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
  }, [basketId, sourceFilter]);

  // Toggle expanded state
  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Filter entries by search
  const filteredEntries = entries.filter((entry) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      entry.body.toLowerCase().includes(query) ||
      entry.title?.toLowerCase().includes(query)
    );
  });

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Get supervision status icon
  const getSupervisionIcon = (status?: string) => {
    switch (status) {
      case "approved":
        return <CheckCircle className="h-3 w-3 text-green-600" />;
      case "rejected":
        return <XCircle className="h-3 w-3 text-red-600" />;
      case "pending_review":
        return <Clock className="h-3 w-3 text-yellow-600" />;
      default:
        return null;
    }
  };

  // Truncate body for preview
  const getPreview = (body: string, maxLength = 200) => {
    if (body.length <= maxLength) return body;
    return body.slice(0, maxLength) + "...";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-3 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>{error}</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-foreground">
            Entries ({filteredEntries.length})
          </h3>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>{counts.rawDumps} user</span>
            <span>•</span>
            <span>{counts.workOutputs} agent</span>
          </div>
        </div>
        <div className="flex gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search entries..."
              className="pl-9 w-64"
            />
          </div>

          {/* Source Filter */}
          <Select
            value={sourceFilter}
            onValueChange={(v) => setSourceFilter(v as "all" | "user" | "agent")}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="All Sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="user">User Only</SelectItem>
              <SelectItem value="agent">Agent Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Entries List */}
      {filteredEntries.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">
            {entries.length === 0
              ? "No entries yet. Use the \"Add Context\" button to add text content."
              : "No entries match your search."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredEntries.map((entry) => {
            const isExpanded = expandedIds.has(entry.id);
            const needsTruncation = entry.body.length > 200;

            return (
              <Card
                key={entry.id}
                className="p-4 hover:border-primary/50 transition-colors"
              >
                {/* Header row */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <SourceBadge
                      source={entry.source}
                      agentType={entry.agent_type}
                    />

                    {/* Entry type badges */}
                    {entry.output_type && (
                      <Badge variant="outline" className="text-xs">
                        {getOutputTypeLabel(entry.output_type)}
                      </Badge>
                    )}

                    {/* Supervision status for agent entries */}
                    {entry.supervision_status && (
                      <Badge
                        variant={
                          entry.supervision_status === "approved"
                            ? "default"
                            : entry.supervision_status === "rejected"
                            ? "destructive"
                            : "outline"
                        }
                        className="text-xs gap-1"
                      >
                        {getSupervisionIcon(entry.supervision_status)}
                        {getSupervisionStatusLabel(entry.supervision_status)}
                      </Badge>
                    )}

                    {/* Processing status for user entries */}
                    {entry.processing_status && entry.source === "user" && (
                      <Badge
                        variant={
                          entry.processing_status === "processed"
                            ? "default"
                            : entry.processing_status === "processing"
                            ? "outline"
                            : "secondary"
                        }
                        className="text-xs"
                      >
                        {entry.processing_status === "processing" && (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        )}
                        {entry.processing_status}
                      </Badge>
                    )}
                  </div>

                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatDate(entry.created_at)}
                  </span>
                </div>

                {/* Title (if present) */}
                {entry.title && (
                  <h4 className="font-medium text-foreground mb-2">
                    {entry.title}
                  </h4>
                )}

                {/* Body content */}
                <div
                  className={cn(
                    "text-sm text-muted-foreground whitespace-pre-wrap",
                    !isExpanded && needsTruncation && "line-clamp-3"
                  )}
                >
                  {isExpanded ? entry.body : getPreview(entry.body)}
                </div>

                {/* Expand/Collapse button */}
                {needsTruncation && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpanded(entry.id)}
                    className="mt-2 h-7 text-xs"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-3 w-3 mr-1" />
                        Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3 mr-1" />
                        Show more
                      </>
                    )}
                  </Button>
                )}

                {/* Confidence (for agent entries) */}
                {entry.confidence !== undefined && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Confidence: {(entry.confidence * 100).toFixed(0)}%
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
