"use client";

/**
 * AddContextButton - Placeholder for Phase 2 redesign
 *
 * TODO (Phase 2): Redesign context addition flow
 * - Consider schema-driven entry creation
 * - Unified asset/content upload experience
 * - Remove legacy modals approach
 */

import { Button } from "@/components/ui/Button";
import { Plus } from "lucide-react";

interface AddContextButtonProps {
  projectId: string;
  basketId: string;
  onSuccess?: () => void;
}

export default function AddContextButton({
  projectId,
  basketId,
  onSuccess,
}: AddContextButtonProps) {
  // Phase 2: This will be redesigned with a proper schema-driven approach
  // For now, the main way to add context is via the schema cards in ContextEntriesPanel

  return (
    <Button variant="outline" disabled title="Use the + Add buttons on each context type below">
      <Plus className="h-4 w-4 mr-1.5" />
      Add Context
    </Button>
  );
}
