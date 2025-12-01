"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import {
  Image as ImageIcon,
  Loader2,
  AlertCircle,
  Search,
  Download,
  Trash2,
  Sparkles,
  X,
  ZoomIn,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { SourceBadge } from "@/components/context/SourceBadge";
import { formatFileSize, getItemSource } from "@/lib/types/substrate";
import type { Asset } from "@/lib/types/substrate";

interface ContextImagesClientProps {
  projectId: string;
  basketId: string;
}

export default function ContextImagesClient({
  projectId,
  basketId,
}: ContextImagesClientProps) {
  const [images, setImages] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [previewImage, setPreviewImage] = useState<Asset | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Fetch images (assets with mime_category=image)
  const fetchImages = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/baskets/${basketId}/assets?mime_category=image`
      );
      if (!response.ok) throw new Error("Failed to fetch images");

      const data = await response.json();
      setImages(data.assets || []);
      setError(null);
    } catch (err) {
      console.error("[Images] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load images");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
  }, [basketId]);

  // Handle delete
  const handleDelete = async (assetId: string, fileName: string) => {
    if (!confirm(`Delete "${fileName}"?`)) return;

    try {
      const response = await fetch(`/api/baskets/${basketId}/assets/${assetId}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete image");

      toast.success("Image deleted");
      await fetchImages();
    } catch (err) {
      console.error("[Images] Delete error:", err);
      toast.error("Failed to delete image");
    }
  };

  // Handle download / get signed URL
  const getSignedUrl = async (assetId: string): Promise<string | null> => {
    try {
      const response = await fetch(
        `/api/baskets/${basketId}/assets/${assetId}/signed-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expires_in: 3600 }),
        }
      );

      if (!response.ok) throw new Error("Failed to get URL");

      const data = await response.json();
      return data.signed_url;
    } catch (err) {
      console.error("[Images] URL error:", err);
      toast.error("Failed to load image");
      return null;
    }
  };

  // Handle preview
  const handlePreview = async (image: Asset) => {
    const url = await getSignedUrl(image.id);
    if (url) {
      setPreviewImage(image);
      setPreviewUrl(url);
    }
  };

  // Handle download
  const handleDownload = async (assetId: string) => {
    const url = await getSignedUrl(assetId);
    if (url) {
      window.open(url, "_blank");
    }
  };

  // Close preview
  const closePreview = () => {
    setPreviewImage(null);
    setPreviewUrl(null);
  };

  // Filter images by search
  const filteredImages = images.filter((img) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      img.file_name.toLowerCase().includes(query) ||
      img.description?.toLowerCase().includes(query)
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
          Images ({filteredImages.length})
        </h3>
        <div className="flex gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search images..."
              className="pl-9 w-64"
            />
          </div>
        </div>
      </div>

      {/* Images Grid */}
      {filteredImages.length === 0 ? (
        <Card className="p-12 text-center">
          <ImageIcon className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">
            {images.length === 0
              ? "No images yet. Use the \"Add Context\" button to upload screenshots, diagrams, or other visuals."
              : "No images match your search."}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredImages.map((img) => {
            const source = getItemSource(img);

            return (
              <Card
                key={img.id}
                className="group overflow-hidden hover:border-primary/50 transition-colors"
              >
                {/* Thumbnail placeholder */}
                <div
                  className="relative aspect-video bg-muted flex items-center justify-center cursor-pointer"
                  onClick={() => handlePreview(img)}
                >
                  <ImageIcon className="h-8 w-8 text-muted-foreground" />

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <ZoomIn className="h-6 w-6 text-white" />
                  </div>
                </div>

                {/* Info */}
                <div className="p-3">
                  <p className="text-sm font-medium text-foreground truncate mb-1">
                    {img.file_name}
                  </p>
                  <p className="text-xs text-muted-foreground mb-2">
                    {formatFileSize(img.file_size_bytes)}
                  </p>

                  {/* Description */}
                  {img.description && (
                    <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                      {img.description}
                    </p>
                  )}

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1 mb-2">
                    <SourceBadge source={source} showLabel={false} />

                    {img.classification_status === "classifying" && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                      </Badge>
                    )}
                    {img.classification_status === "classified" &&
                      img.asset_type !== "pending_classification" && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          {img.classification_confidence &&
                          img.classification_confidence >= 0.8 ? (
                            <Sparkles className="h-3 w-3" />
                          ) : null}
                          {img.asset_type}
                        </Badge>
                      )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => handleDownload(img.id)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => handleDelete(img.id, img.file_name)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      <Dialog open={!!previewImage} onOpenChange={() => closePreview()}>
        <DialogContent className="max-w-4xl p-0">
          {previewImage && previewUrl && (
            <div className="relative">
              {/* Close button */}
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2 z-10 bg-black/50 hover:bg-black/70 text-white"
                onClick={closePreview}
              >
                <X className="h-4 w-4" />
              </Button>

              {/* Image */}
              <img
                src={previewUrl}
                alt={previewImage.file_name}
                className="w-full h-auto max-h-[80vh] object-contain"
              />

              {/* Info bar */}
              <div className="p-4 bg-background border-t">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{previewImage.file_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatFileSize(previewImage.file_size_bytes)}
                      {previewImage.description && ` • ${previewImage.description}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <SourceBadge source={getItemSource(previewImage)} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownload(previewImage.id)}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
