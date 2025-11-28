"use client";

import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Upload, X, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface AssetType {
  asset_type: string;
  display_name: string;
  category: string;
  allowed_mime_types: string[];
}

interface UploadAssetModalProps {
  open: boolean;
  onClose: () => void;
  basketId: string;
  assetTypes: AssetType[];
  onUploadSuccess: () => void;
}

const AGENT_TYPES = [
  { value: "research", label: "Research Agent" },
  { value: "content", label: "Content Agent" },
  { value: "reporting", label: "Reporting Agent" },
];

export default function UploadAssetModal({
  open,
  onClose,
  basketId,
  assetTypes,
  onUploadSuccess,
}: UploadAssetModalProps) {
  const [uploading, setUploading] = useState(false);
  const [selectedAssetType, setSelectedAssetType] = useState<string>(
    assetTypes.length > 0 ? assetTypes[0].asset_type : ""
  );
  const [selectedAgentScope, setSelectedAgentScope] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Dropzone configuration
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        setSelectedFile(acceptedFiles[0]);
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

  // Handle upload
  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error("Please select a file");
      return;
    }
    if (!selectedAssetType) {
      toast.error("Please select an asset type");
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("asset_type", selectedAssetType);
      if (description) formData.append("description", description);
      if (selectedAgentScope.length > 0) {
        formData.append("agent_scope", selectedAgentScope.join(","));
      }
      if (tags.length > 0) {
        formData.append("tags", tags.join(","));
      }
      formData.append("permanence", "permanent");

      const response = await fetch(`/api/baskets/${basketId}/assets`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(errorData.detail || "Upload failed");
      }

      toast.success("Asset uploaded successfully");

      // Reset form and close modal
      resetForm();
      onUploadSuccess();
      onClose();
    } catch (err) {
      console.error("[Assets] Upload error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to upload asset");
    } finally {
      setUploading(false);
    }
  };

  // Reset form
  const resetForm = () => {
    setSelectedFile(null);
    setDescription("");
    setTags([]);
    setSelectedAgentScope([]);
    setTagInput("");
  };

  // Add tag
  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput("");
    }
  };

  // Toggle agent scope
  const toggleAgentScope = (agentType: string) => {
    setSelectedAgentScope((prev) =>
      prev.includes(agentType)
        ? prev.filter((a) => a !== agentType)
        : [...prev, agentType]
    );
  };

  const handleClose = () => {
    if (!uploading) {
      resetForm();
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <DialogContent className="max-w-lg w-full max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-4 border-b border-surface-primary-border">
          <DialogTitle className="text-lg font-medium text-foreground">
            Upload Asset
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* File Drop Zone */}
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
              isDragActive
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/20 hover:border-primary/50",
              selectedFile && "border-primary bg-primary/5"
            )}
          >
            <input {...getInputProps()} />
            <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
            {selectedFile ? (
              <div>
                <p className="text-sm font-medium text-foreground">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-foreground">
                  {isDragActive ? "Drop file here" : "Drag and drop a file, or click to select"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Max file size: 50MB</p>
              </div>
            )}
          </div>

          {/* Asset Type Selector */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">Asset Type</label>
            <Select value={selectedAssetType} onValueChange={setSelectedAssetType}>
              <SelectTrigger>
                <SelectValue placeholder="Select asset type" />
              </SelectTrigger>
              <SelectContent>
                {assetTypes.map((type) => (
                  <SelectItem key={type.asset_type} value={type.asset_type}>
                    {type.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Agent Scope Selector */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Agent Scope (optional)
            </label>
            <div className="flex flex-wrap gap-2">
              {AGENT_TYPES.map((agent) => (
                <Badge
                  key={agent.value}
                  variant={selectedAgentScope.includes(agent.value) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleAgentScope(agent.value)}
                >
                  {agent.label}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Leave empty to make asset available to all agents
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Description (optional)
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this asset..."
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Tags (optional)
            </label>
            <div className="flex gap-2 mb-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTag())}
                placeholder="Add tag..."
              />
              <Button onClick={handleAddTag} variant="outline" size="sm">
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                    {tag}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => setTags(tags.filter((t) => t !== tag))}
                    />
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-surface-primary-border p-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleClose} disabled={uploading}>
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
            size="sm"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
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
