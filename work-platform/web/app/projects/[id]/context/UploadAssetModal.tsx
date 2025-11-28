"use client";

import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Upload, Loader2, Sparkles, CheckCircle } from "lucide-react";
import { toast } from "sonner";

interface UploadAssetModalProps {
  open: boolean;
  onClose: () => void;
  basketId: string;
  onUploadSuccess: () => void;
}

export default function UploadAssetModal({
  open,
  onClose,
  basketId,
  onUploadSuccess,
}: UploadAssetModalProps) {
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadComplete, setUploadComplete] = useState(false);

  // Dropzone configuration
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        setSelectedFile(acceptedFiles[0]);
        setUploadComplete(false);
      }
    },
    multiple: false,
    maxSize: 50 * 1024 * 1024, // 50MB
  });

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Handle minimal upload with auto-classification
  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error("Please select a file");
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", selectedFile);

      // Use the new minimal upload endpoint
      const response = await fetch(`/api/baskets/${basketId}/assets/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(errorData.detail || "Upload failed");
      }

      const result = await response.json();

      setUploadComplete(true);
      toast.success(
        "Asset uploaded! Classification in progress...",
        {
          description: "You'll be notified when classification completes.",
          duration: 4000,
        }
      );

      // Brief delay to show success state, then close
      setTimeout(() => {
        resetForm();
        onUploadSuccess();
        onClose();
      }, 1500);

    } catch (err) {
      console.error("[Assets] Upload error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to upload asset");
      setUploading(false);
    }
  };

  // Reset form
  const resetForm = () => {
    setSelectedFile(null);
    setUploading(false);
    setUploadComplete(false);
  };

  const handleClose = () => {
    if (!uploading) {
      resetForm();
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <DialogContent className="max-w-md w-full p-0">
        <DialogHeader className="p-4 border-b border-surface-primary-border">
          <DialogTitle className="text-lg font-medium text-foreground">
            Upload Asset
          </DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4">
          {/* File Drop Zone */}
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
              isDragActive
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/20 hover:border-primary/50",
              selectedFile && "border-primary bg-primary/5",
              uploadComplete && "border-green-500 bg-green-500/5"
            )}
          >
            <input {...getInputProps()} disabled={uploading || uploadComplete} />

            {uploadComplete ? (
              <div>
                <CheckCircle className="h-8 w-8 mx-auto mb-3 text-green-500" />
                <p className="text-sm font-medium text-foreground">Upload complete!</p>
                <p className="text-xs text-muted-foreground mt-1">
                  AI is classifying your asset...
                </p>
              </div>
            ) : selectedFile ? (
              <div>
                <Upload className="h-8 w-8 mx-auto mb-3 text-primary" />
                <p className="text-sm font-medium text-foreground">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
            ) : (
              <div>
                <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-foreground">
                  {isDragActive ? "Drop file here" : "Drag and drop a file, or click to select"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Max file size: 50MB</p>
              </div>
            )}
          </div>

          {/* Auto-classification info */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
            <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">AI-Powered Classification</p>
              <p>
                Your asset will be automatically classified and described.
                You can adjust the classification later if needed.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-surface-primary-border p-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleClose} disabled={uploading}>
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || uploading || uploadComplete}
            size="sm"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : uploadComplete ? (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Done
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
