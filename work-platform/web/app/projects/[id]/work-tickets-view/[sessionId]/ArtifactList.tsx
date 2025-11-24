"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Copy, CheckCircle, Download, FileText } from "lucide-react";

/**
 * Phase 2e Work Output Schema
 */
interface WorkOutput {
  id: string;
  output_type: string;
  agent_type: string;
  title: string;
  body: string | null;  // TEXT column (JSON string or markdown)
  confidence: number;
  file_id: string | null;
  file_format: string | null;  // e.g., "pptx", "pdf", "xlsx"
  file_size_bytes: number | null;
  mime_type: string | null;
  generation_method: string;  // "text" or "skill"
  supervision_status: string;  // "pending_review", "approved", etc.
  created_at: string;
}

interface ArtifactListProps {
  artifacts: WorkOutput[];
}

export default function ArtifactList({ artifacts }: ArtifactListProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (artifact: WorkOutput) => {
    try {
      const textToCopy = artifact.body || JSON.stringify(artifact, null, 2);
      await navigator.clipboard.writeText(textToCopy);
      setCopiedId(artifact.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleDownload = (artifact: WorkOutput) => {
    if (!artifact.file_id) return;

    // TODO: Implement actual file download from substrate-API
    // For now, show alert that download will be implemented
    alert(`File download will be implemented. File ID: ${artifact.file_id}, Format: ${artifact.file_format}`);
  };

  if (artifacts.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground text-sm text-center">
          No work outputs generated yet.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {artifacts.map((artifact) => {
        const isFileOutput = artifact.file_id && artifact.generation_method === 'skill';
        const fileExtension = artifact.file_format?.toUpperCase() || 'FILE';

        // Parse body if it's JSON string
        let bodyContent: any = artifact.body;
        try {
          if (artifact.body && typeof artifact.body === 'string') {
            bodyContent = JSON.parse(artifact.body);
          }
        } catch {
          // Keep as string if not valid JSON
          bodyContent = artifact.body;
        }

        return (
          <Card key={artifact.id} className="p-6">
            <details open>
              <summary className="cursor-pointer font-medium text-foreground flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isFileOutput && (
                    <FileText className="h-5 w-5 text-primary" />
                  )}
                  <div>
                    <span className="text-base font-semibold">{artifact.title}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground capitalize">
                        {artifact.output_type.replace(/_/g, ' ')}
                      </span>
                      {isFileOutput && (
                        <Badge variant="default" className="text-[11px]">
                          {fileExtension} File
                        </Badge>
                      )}
                      <Badge
                        variant={artifact.confidence >= 0.8 ? 'default' : artifact.confidence >= 0.6 ? 'secondary' : 'outline'}
                        className="text-[11px]"
                      >
                        {Math.round(artifact.confidence * 100)}% confidence
                      </Badge>
                      <Badge variant="secondary" className="text-[11px] capitalize">
                        {artifact.supervision_status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  {isFileOutput ? (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        handleDownload(artifact);
                      }}
                      className="gap-2"
                    >
                      <Download className="h-4 w-4" />
                      Download {fileExtension}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        handleCopy(artifact);
                      }}
                      className="gap-2"
                    >
                      {copiedId === artifact.id ? (
                        <>
                          <CheckCircle className="h-4 w-4" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copy
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </summary>

              <div className="mt-4 space-y-3">
                {/* File Output - Show metadata */}
                {isFileOutput ? (
                  <div className="bg-muted p-4 rounded border border-border">
                    <h4 className="text-sm font-medium text-foreground/80 mb-3">
                      📄 File Information:
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">Format:</span>
                        <span className="ml-2 font-medium">{artifact.file_format?.toUpperCase()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Size:</span>
                        <span className="ml-2 font-medium">
                          {artifact.file_size_bytes
                            ? `${(artifact.file_size_bytes / 1024).toFixed(1)} KB`
                            : 'Unknown'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">MIME Type:</span>
                        <span className="ml-2 font-medium text-xs">{artifact.mime_type || 'Unknown'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Generated via:</span>
                        <span className="ml-2 font-medium">Claude Skills</span>
                      </div>
                    </div>
                    {artifact.body && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <h5 className="text-xs font-medium text-muted-foreground mb-2">Description:</h5>
                        <p className="text-sm text-foreground/90 line-clamp-3">
                          {typeof bodyContent === 'string' ? bodyContent.substring(0, 200) + '...' : JSON.stringify(bodyContent).substring(0, 200) + '...'}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Text Output - Show content */
                  <div>
                    <h4 className="text-sm font-medium text-foreground/80 mb-2">
                      📝 Content:
                    </h4>
                    {typeof bodyContent === 'string' ? (
                      <div className="prose prose-sm max-w-none bg-surface-primary p-4 rounded border border-surface-primary-border">
                        <pre className="whitespace-pre-wrap font-sans text-foreground text-sm leading-relaxed">
                          {bodyContent}
                        </pre>
                      </div>
                    ) : (
                      <pre className="text-xs bg-muted p-3 rounded border border-border overflow-auto max-h-96">
                        {JSON.stringify(bodyContent, null, 2)}
                      </pre>
                    )}
                  </div>
                )}

                {/* Metadata */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border">
                  <span>ID: {artifact.id.slice(0, 8)}...</span>
                  <span>Agent: {artifact.agent_type}</span>
                  <span>
                    Created: {new Date(artifact.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
            </details>
          </Card>
        );
      })}
    </div>
  );
}
