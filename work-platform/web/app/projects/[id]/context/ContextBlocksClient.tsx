"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import {
  Database,
  Brain,
  Search,
  Loader2,
  AlertCircle
} from "lucide-react";
import { ProjectHealthCheck } from "@/components/projects/ProjectHealthCheck";
import BlockDetailModal from "@/components/context/BlockDetailModal";
import CoreContextSection from "@/components/context/CoreContextSection";
import TemplateFormModal from "@/components/context/TemplateFormModal";

interface Block {
  id: string;
  title: string;
  content: string;
  semantic_type: string;
  state: string;
  confidence: number | null;
  times_referenced: number | null;
  created_at: string;
  anchor_role: string | null;
}

interface ContextBlocksClientProps {
  projectId: string;
  basketId: string;
  onAddContextClick?: () => void;
}

// Template type for CoreContextSection
interface Template {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  schema: any;
  is_required: boolean;
  display_order: number;
  icon: string | null;
  is_filled: boolean;
  block_id: string | null;
  filled_at: string | null;
}

export default function ContextBlocksClient({ projectId, basketId, onAddContextClick }: ContextBlocksClientProps) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "knowledge" | "meaning">("all");
  const [isPolling, setIsPolling] = useState(false);
  const [pollingMessage, setPollingMessage] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  // Template state
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [coreContextKey, setCoreContextKey] = useState(0); // For refreshing CoreContextSection

  // Fetch blocks from BFF
  const fetchBlocks = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${projectId}/context`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(errorData.detail || `Failed to fetch context blocks (${response.status})`);
      }

      const data = await response.json();
      setBlocks(data.blocks || []);
      setError(null);
    } catch (err) {
      console.error("[Context Blocks] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load context");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBlocks();
  }, [projectId]);

  // Polling logic for new blocks after context submission
  const startPolling = () => {
    const initialCount = blocks.length;
    setIsPolling(true);
    setPollingMessage("Processing context... checking for new blocks");

    let attempts = 0;
    const maxAttempts = 20; // 20 attempts * 3s = 60s max

    const pollInterval = setInterval(async () => {
      attempts++;

      try {
        // Fetch without setting loading state (silent poll)
        const response = await fetch(`/api/projects/${projectId}/context`);
        if (response.ok) {
          const data = await response.json();
          const newBlocks = data.blocks || [];

          if (newBlocks.length > initialCount) {
            // New blocks appeared!
            setBlocks(newBlocks);
            setIsPolling(false);
            setPollingMessage(`✓ ${newBlocks.length - initialCount} new block(s) added!`);
            clearInterval(pollInterval);

            // Clear success message after 5 seconds
            setTimeout(() => setPollingMessage(null), 5000);
            return;
          }
        }
      } catch (err) {
        console.error("[Context Blocks] Polling error:", err);
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        setIsPolling(false);
        setPollingMessage("Processing may still be in progress. Refresh to see updates.");

        // Clear timeout message after 8 seconds
        setTimeout(() => setPollingMessage(null), 8000);
      } else {
        // Update message with remaining time
        const remainingSeconds = (maxAttempts - attempts) * 3;
        setPollingMessage(`Processing context... (${remainingSeconds}s remaining)`);
      }
    }, 3000); // Poll every 3 seconds
  };

  // Semantic type categorization (matches P0-P4 pipeline output)
  const KNOWLEDGE_TYPES = ["fact", "metric", "event", "insight", "action", "finding", "quote", "summary"];
  const MEANING_TYPES = ["intent", "objective", "rationale", "principle", "assumption", "context", "constraint"];

  // Filter blocks
  const filteredBlocks = blocks.filter((block) => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        block.title.toLowerCase().includes(query) ||
        block.content.toLowerCase().includes(query) ||
        block.semantic_type.toLowerCase().includes(query);
      if (!matchesSearch) return false;
    }

    // Category filter
    if (filter === "knowledge") {
      return KNOWLEDGE_TYPES.includes(block.semantic_type.toLowerCase());
    }
    if (filter === "meaning") {
      return MEANING_TYPES.includes(block.semantic_type.toLowerCase());
    }

    return true;
  });

  // Stats
  const knowledgeCount = blocks.filter((b) =>
    KNOWLEDGE_TYPES.includes(b.semantic_type.toLowerCase())
  ).length;
  const meaningCount = blocks.filter((b) =>
    MEANING_TYPES.includes(b.semantic_type.toLowerCase())
  ).length;

  if (loading) {
    return (
      <Card className="p-12">
        <div className="flex flex-col items-center justify-center text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Loading context blocks...</p>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-12">
        <div className="flex flex-col items-center justify-center text-center">
          <AlertCircle className="h-8 w-8 text-destructive mb-4" />
          <p className="text-foreground font-medium">Failed to Load Context</p>
          <p className="text-muted-foreground text-sm mt-2">{error}</p>
          <p className="text-muted-foreground/80 text-xs mt-4">
            This may indicate that the basket doesn't exist in substrate-api yet, or there are connectivity issues.
          </p>
        </div>
      </Card>
    );
  }

  const pollingIntent = pollingMessage
    ? pollingMessage.startsWith('✓')
      ? 'success'
      : pollingMessage.startsWith('Processing may')
        ? 'warning'
        : 'info'
    : null;

  const pollingStyles: Record<string, string> = {
    success: 'border-surface-success-border bg-surface-success text-success-foreground',
    warning: 'border-surface-warning-border bg-surface-warning text-warning-foreground',
    info: 'border-surface-primary-border bg-surface-primary text-foreground',
  };

  // Template handlers
  const handleTemplateClick = (template: Template) => {
    setSelectedTemplate(template);
    setTemplateModalOpen(true);
  };

  const handleTemplateSuccess = () => {
    // Refresh CoreContextSection by changing key
    setCoreContextKey((prev) => prev + 1);
    // Also refresh blocks in case a template block was added
    fetchBlocks();
  };

  return (
    <div className="space-y-6">
      {/* Core Context Section - Pinned at top */}
      <CoreContextSection
        key={coreContextKey}
        projectId={projectId}
        basketId={basketId}
        onTemplateClick={handleTemplateClick}
      />

      {/* Template Form Modal */}
      <TemplateFormModal
        template={selectedTemplate}
        projectId={projectId}
        open={templateModalOpen}
        onClose={() => {
          setTemplateModalOpen(false);
          setSelectedTemplate(null);
        }}
        onSuccess={handleTemplateSuccess}
      />

      {/* Project Health Check */}
      <ProjectHealthCheck projectId={projectId} basketId={basketId} />

      {/* Polling Status Message */}
      {pollingMessage && (
        <div className={cn('rounded-lg border p-4', pollingIntent ? pollingStyles[pollingIntent] : '')}>
          <div className="flex items-center gap-3">
            {isPolling && (
              <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
            )}
            <p className="text-sm font-medium">{pollingMessage}</p>
          </div>
        </div>
      )}

      {/* Stats Bar */}
      <div className="flex items-center gap-4">
        <Card className="flex-1 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-muted/60 p-2 text-muted-foreground">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{blocks.length}</p>
              <p className="text-xs text-muted-foreground">Total Blocks</p>
            </div>
          </div>
        </Card>
        <Card className="flex-1 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-surface-primary/70 p-2 text-primary">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{knowledgeCount}</p>
              <p className="text-xs text-muted-foreground">Knowledge</p>
            </div>
          </div>
        </Card>
        <Card className="flex-1 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-surface-warning/70 p-2 text-warning-foreground">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{meaningCount}</p>
              <p className="text-xs text-muted-foreground">Meaning</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Search & Filters */}
      <div className="flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search blocks by title, content, or type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
          >
            All
          </Button>
          <Button
            variant={filter === "knowledge" ? "default" : "outline"}
            onClick={() => setFilter("knowledge")}
          >
            Knowledge
          </Button>
          <Button
            variant={filter === "meaning" ? "default" : "outline"}
            onClick={() => setFilter("meaning")}
          >
            Meaning
          </Button>
        </div>
      </div>

      {/* Blocks List */}
      {filteredBlocks.length === 0 ? (
        <Card className="p-12">
          <div className="text-center">
            <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">No context blocks found</p>
            <p className="text-muted-foreground/80 text-sm mt-2">
              {searchQuery || filter !== "all"
                ? "Try adjusting your search or filters"
                : "Add content to your project to build substrate context"}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredBlocks.map((block) => (
            <Card key={block.id} className="p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-3 mb-3">
                <h3 className="font-medium text-foreground flex-1 line-clamp-2">
                  {block.title}
                </h3>
                <div className="flex gap-2 flex-shrink-0">
                  <Badge variant="outline">
                    {block.semantic_type}
                  </Badge>
                  {block.state === 'PROPOSED' && (
                    <Badge variant="outline" className="bg-warning text-warning-foreground border-warning-foreground/50">
                      Pending Review
                    </Badge>
                  )}
                </div>
              </div>

              <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                {block.content}
              </p>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-3">
                  {block.confidence !== null && (
                    <span>
                      {Math.round(block.confidence * 100)}% confidence
                    </span>
                  )}
                  {block.times_referenced !== null && block.times_referenced > 0 && (
                    <span>{block.times_referenced} refs</span>
                  )}
                </div>
                <button
                  onClick={() => setSelectedBlockId(block.id)}
                  className="flex items-center gap-1 text-primary hover:text-primary/80 transition-colors"
                >
                  <span>Show Details</span>
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Block Detail Modal */}
      <BlockDetailModal
        blockId={selectedBlockId}
        projectId={projectId}
        basketId={basketId}
        open={selectedBlockId !== null}
        onClose={() => setSelectedBlockId(null)}
      />
    </div>
  );
}
