"use client";

import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export default function ContextInfoPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center justify-center rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="How agents use context"
        >
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="start" sideOffset={8}>
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-foreground">
            How Agents Use Context
          </h4>
          <p className="text-sm text-muted-foreground leading-relaxed">
            When executing work, agents query these blocks to understand your project's knowledge and meaning.
            Richer context leads to higher quality work outputs. Context is the foundation of agent intelligence.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
