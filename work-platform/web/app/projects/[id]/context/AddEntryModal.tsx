"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Label } from "@/components/ui/Label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FileText, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface AddEntryModalProps {
  open: boolean;
  onClose: () => void;
  basketId: string;
  onSuccess: () => void;
}

export default function AddEntryModal({
  open,
  onClose,
  basketId,
  onSuccess,
}: AddEntryModalProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [triggerPipeline, setTriggerPipeline] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!body.trim()) {
      toast.error("Please enter some content");
      return;
    }

    try {
      setSubmitting(true);

      const response = await fetch(`/api/baskets/${basketId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: body.trim(),
          title: title.trim() || undefined,
          trigger_pipeline: triggerPipeline,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: "Failed to create entry" }));
        throw new Error(error.detail || "Failed to create entry");
      }

      toast.success(
        triggerPipeline
          ? "Entry added! Knowledge extraction will begin shortly."
          : "Entry added successfully."
      );

      // Reset form
      setTitle("");
      setBody("");
      setTriggerPipeline(true);

      onSuccess();
    } catch (err) {
      console.error("[AddEntry] Error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to create entry");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting) {
      setTitle("");
      setBody("");
      setTriggerPipeline(true);
      onClose();
    }
  };

  // Don't render when closed to ensure complete cleanup
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Add Text Entry
          </DialogTitle>
          <DialogDescription>
            Add raw text content to your project context. This can be notes, research, or any text you want to reference.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Title (optional) */}
          <div className="space-y-2">
            <Label htmlFor="entry-title">Title (optional)</Label>
            <Input
              id="entry-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give this entry a title..."
              disabled={submitting}
            />
          </div>

          {/* Body content */}
          <div className="space-y-2">
            <Label htmlFor="entry-body">Content</Label>
            <Textarea
              id="entry-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Paste or type your content here..."
              className="min-h-[200px] resize-y"
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              {body.length} characters
            </p>
          </div>

          {/* Pipeline trigger toggle */}
          <div className="flex items-start gap-3 rounded-lg border p-4">
            <Checkbox
              id="trigger-pipeline"
              checked={triggerPipeline}
              onCheckedChange={(checked) => setTriggerPipeline(checked === true)}
              disabled={submitting}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <Label htmlFor="trigger-pipeline" className="font-medium cursor-pointer">
                  Extract Knowledge
                </Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Automatically extract blocks (facts, decisions, constraints) from this content
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !body.trim()}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Add Entry
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
