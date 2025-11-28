"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import {
  Upload,
  FileBox,
  Trash2,
  Download,
  Loader2,
  AlertCircle,
  Search,
  FileText,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import UploadAssetModal from "./UploadAssetModal";

interface ReferenceAsset {
  id: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  asset_type: string;
  asset_category: string;
  agent_scope: string[];
  description: string | null;
  tags: string[];
  created_at: string;
  storage_path: string;
  classification_status?: string;
  classification_confidence?: number;
}

interface AssetType {
  asset_type: string;
  display_name: string;
  category: string;
  allowed_mime_types: string[];
}

interface ContextAssetsClientProps {
  projectId: string;
  basketId: string;
}

const AGENT_TYPES = [
  { value: "research", label: "Research Agent" },
  { value: "content", label: "Content Agent" },
  { value: "reporting", label: "Reporting Agent" },
];

export default function ContextAssetsClient({ projectId, basketId }: ContextAssetsClientProps) {
  const [assets, setAssets] = useState<ReferenceAsset[]>([]);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // Fetch asset types
  const fetchAssetTypes = async () => {
    try {
      const response = await fetch(`/api/baskets/${basketId}/asset-types`);
      if (!response.ok) throw new Error("Failed to fetch asset types");
      const data = await response.json();
      setAssetTypes(data);
    } catch (err) {
      console.error("[Assets] Error fetching asset types:", err);
      toast.error("Failed to load asset types");
    }
  };

  // Fetch assets
  const fetchAssets = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/baskets/${basketId}/assets`);
      if (!response.ok) throw new Error("Failed to fetch assets");
      const data = await response.json();
      setAssets(data.assets || []);
      setError(null);
    } catch (err) {
      console.error("[Assets] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load assets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssetTypes();
    fetchAssets();
  }, [basketId]);

  // Handle delete
  const handleDelete = async (assetId: string, fileName: string) => {
    if (!confirm(`Delete "${fileName}"?`)) return;

    try {
      const response = await fetch(`/api/baskets/${basketId}/assets/${assetId}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete asset");

      toast.success("Asset deleted");
      await fetchAssets();
    } catch (err) {
      console.error("[Assets] Delete error:", err);
      toast.error("Failed to delete asset");
    }
  };

  // Handle download
  const handleDownload = async (assetId: string, fileName: string) => {
    try {
      const response = await fetch(`/api/baskets/${basketId}/assets/${assetId}/signed-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expires_in: 3600 }),
      });

      if (!response.ok) throw new Error("Failed to get download URL");

      const data = await response.json();
      window.open(data.signed_url, "_blank");
    } catch (err) {
      console.error("[Assets] Download error:", err);
      toast.error("Failed to download asset");
    }
  };

  // Filter assets
  const filteredAssets = assets.filter((asset) => {
    const matchesSearch =
      searchQuery === "" ||
      asset.file_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.description?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesType = filterType === "all" || asset.asset_type === filterType;

    const matchesAgent =
      filterAgent === "all" ||
      (asset.agent_scope && asset.agent_scope.includes(filterAgent));

    return matchesSearch && matchesType && matchesAgent;
  });

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Get file icon
  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) return <ImageIcon className="h-5 w-5" />;
    return <FileText className="h-5 w-5" />;
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
      {/* Header with Upload Button */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">
          Assets ({filteredAssets.length})
        </h3>
        <div className="flex gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search assets..."
              className="pl-9 w-64"
            />
          </div>

          {/* Filter by Type */}
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {assetTypes.map((type) => (
                <SelectItem key={type.asset_type} value={type.asset_type}>
                  {type.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Filter by Agent */}
          <Select value={filterAgent} onValueChange={setFilterAgent}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All Agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Agents</SelectItem>
              {AGENT_TYPES.map((agent) => (
                <SelectItem key={agent.value} value={agent.value}>
                  {agent.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Upload Button */}
          <Button onClick={() => setUploadModalOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload Asset
          </Button>
        </div>
      </div>

      {/* Assets Grid */}
      {filteredAssets.length === 0 ? (
        <Card className="p-12 text-center">
          <FileBox className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground mb-4">
            {assets.length === 0
              ? "No assets yet. Upload your first asset to get started."
              : "No assets match your filters."}
          </p>
          {assets.length === 0 && (
            <Button onClick={() => setUploadModalOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload Asset
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAssets.map((asset) => (
            <Card key={asset.id} className="p-4 hover:border-primary/50 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {getFileIcon(asset.mime_type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {asset.file_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(asset.file_size_bytes)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownload(asset.id, asset.file_name)}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(asset.id, asset.file_name)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              {asset.description && (
                <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                  {asset.description}
                </p>
              )}

              <div className="flex flex-wrap gap-1 mb-2">
                {/* Classification status indicator */}
                {asset.classification_status === "classifying" && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Classifying...
                  </Badge>
                )}
                {asset.classification_status === "classified" && asset.asset_type !== "pending_classification" && (
                  <Badge variant="secondary" className="text-xs gap-1">
                    {asset.classification_confidence && asset.classification_confidence >= 0.8 ? (
                      <Sparkles className="h-3 w-3" />
                    ) : null}
                    {assetTypes.find((t) => t.asset_type === asset.asset_type)?.display_name ||
                      asset.asset_type}
                  </Badge>
                )}
                {(!asset.classification_status || asset.classification_status === "unclassified") && (
                  <Badge variant="secondary" className="text-xs">
                    {assetTypes.find((t) => t.asset_type === asset.asset_type)?.display_name ||
                      asset.asset_type}
                  </Badge>
                )}
                {asset.agent_scope && asset.agent_scope.length > 0 && (
                  <>
                    {asset.agent_scope.map((agent) => (
                      <Badge key={agent} variant="outline" className="text-xs">
                        {AGENT_TYPES.find((a) => a.value === agent)?.label || agent}
                      </Badge>
                    ))}
                  </>
                )}
              </div>

              {asset.tags && asset.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {asset.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      #{tag}
                    </Badge>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      <UploadAssetModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        basketId={basketId}
        onUploadSuccess={fetchAssets}
      />
    </div>
  );
}
