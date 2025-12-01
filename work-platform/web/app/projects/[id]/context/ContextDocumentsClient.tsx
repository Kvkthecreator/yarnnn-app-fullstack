"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import {
  FileText,
  FileSpreadsheet,
  FileBox,
  File,
  Loader2,
  AlertCircle,
  Search,
  Download,
  Trash2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { SourceBadge } from "@/components/context/SourceBadge";
import { formatFileSize, getItemSource } from "@/lib/types/substrate";
import type { Asset } from "@/lib/types/substrate";

interface ContextDocumentsClientProps {
  projectId: string;
  basketId: string;
}

// Map MIME types to icons
function getDocumentIcon(mimeType: string) {
  if (mimeType === "application/pdf") {
    return <FileText className="h-5 w-5 text-red-500" />;
  }
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    mimeType === "text/csv"
  ) {
    return <FileSpreadsheet className="h-5 w-5 text-green-600" />;
  }
  if (mimeType.includes("word") || mimeType.includes("document")) {
    return <FileText className="h-5 w-5 text-blue-600" />;
  }
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) {
    return <FileBox className="h-5 w-5 text-orange-500" />;
  }
  return <File className="h-5 w-5 text-muted-foreground" />;
}

// Get file extension display
function getFileExtension(fileName: string): string {
  const ext = fileName.split(".").pop()?.toUpperCase();
  return ext || "FILE";
}

export default function ContextDocumentsClient({
  projectId,
  basketId,
}: ContextDocumentsClientProps) {
  const [documents, setDocuments] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch documents (assets with mime_category=document)
  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/baskets/${basketId}/assets?mime_category=document`
      );
      if (!response.ok) throw new Error("Failed to fetch documents");

      const data = await response.json();
      setDocuments(data.assets || []);
      setError(null);
    } catch (err) {
      console.error("[Documents] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [basketId]);

  // Handle delete
  const handleDelete = async (assetId: string, fileName: string) => {
    if (!confirm(`Delete "${fileName}"?`)) return;

    try {
      const response = await fetch(`/api/baskets/${basketId}/assets/${assetId}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete document");

      toast.success("Document deleted");
      await fetchDocuments();
    } catch (err) {
      console.error("[Documents] Delete error:", err);
      toast.error("Failed to delete document");
    }
  };

  // Handle download
  const handleDownload = async (assetId: string, fileName: string) => {
    try {
      const response = await fetch(
        `/api/baskets/${basketId}/assets/${assetId}/signed-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expires_in: 3600 }),
        }
      );

      if (!response.ok) throw new Error("Failed to get download URL");

      const data = await response.json();
      window.open(data.signed_url, "_blank");
    } catch (err) {
      console.error("[Documents] Download error:", err);
      toast.error("Failed to download document");
    }
  };

  // Filter documents by search
  const filteredDocuments = documents.filter((doc) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      doc.file_name.toLowerCase().includes(query) ||
      doc.description?.toLowerCase().includes(query)
    );
  });

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
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
        <h3 className="text-lg font-semibold text-foreground">
          Documents ({filteredDocuments.length})
        </h3>
        <div className="flex gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documents..."
              className="pl-9 w-64"
            />
          </div>
        </div>
      </div>

      {/* Documents Grid */}
      {filteredDocuments.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">
            {documents.length === 0
              ? "No documents yet. Use the \"Add Context\" button to upload PDFs, spreadsheets, or other documents."
              : "No documents match your search."}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDocuments.map((doc) => {
            const source = getItemSource(doc);

            return (
              <Card
                key={doc.id}
                className="p-4 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {getDocumentIcon(doc.mime_type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {doc.file_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(doc.file_size_bytes)} •{" "}
                        {getFileExtension(doc.file_name)}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownload(doc.id, doc.file_name)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(doc.id, doc.file_name)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                {/* Description */}
                {doc.description && (
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                    {doc.description}
                  </p>
                )}

                {/* Badges */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {/* Source badge */}
                  <SourceBadge source={source} />

                  {/* Classification status */}
                  {doc.classification_status === "classifying" && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Classifying...
                    </Badge>
                  )}
                  {doc.classification_status === "classified" &&
                    doc.asset_type !== "pending_classification" && (
                      <Badge variant="secondary" className="text-xs gap-1">
                        {doc.classification_confidence &&
                        doc.classification_confidence >= 0.8 ? (
                          <Sparkles className="h-3 w-3" />
                        ) : null}
                        {doc.asset_type}
                      </Badge>
                    )}
                </div>

                {/* Date */}
                <div className="text-xs text-muted-foreground">
                  {formatDate(doc.created_at)}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
