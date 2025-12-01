"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Database, FileText, FileBox, Image } from "lucide-react";
import ContextBlocksClient from "./ContextBlocksClient";
import ContextEntriesClient from "./ContextEntriesClient";
import ContextDocumentsClient from "./ContextDocumentsClient";
import ContextImagesClient from "./ContextImagesClient";

type TabValue = "blocks" | "entries" | "documents" | "images";

interface ContextPageClientProps {
  projectId: string;
  basketId: string;
}

/**
 * ContextPageClient - Renders the 4-tab context view
 *
 * Modal management is centralized in AddContextButton (rendered in page header).
 * Tab components are display-only and do not manage their own modals.
 */
export default function ContextPageClient({ projectId, basketId }: ContextPageClientProps) {
  const [activeTab, setActiveTab] = useState<TabValue>("blocks");

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as TabValue)}
      className="w-full"
    >
      <TabsList className="grid w-full max-w-[600px] grid-cols-4">
        <TabsTrigger value="blocks" className="flex items-center gap-2">
          <Database className="h-4 w-4" />
          Blocks
        </TabsTrigger>
        <TabsTrigger value="entries" className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Entries
        </TabsTrigger>
        <TabsTrigger value="documents" className="flex items-center gap-2">
          <FileBox className="h-4 w-4" />
          Documents
        </TabsTrigger>
        <TabsTrigger value="images" className="flex items-center gap-2">
          <Image className="h-4 w-4" />
          Images
        </TabsTrigger>
      </TabsList>

      <TabsContent value="blocks" className="mt-6">
        <ContextBlocksClient projectId={projectId} basketId={basketId} />
      </TabsContent>

      <TabsContent value="entries" className="mt-6">
        <ContextEntriesClient
          projectId={projectId}
          basketId={basketId}
        />
      </TabsContent>

      <TabsContent value="documents" className="mt-6">
        <ContextDocumentsClient
          projectId={projectId}
          basketId={basketId}
        />
      </TabsContent>

      <TabsContent value="images" className="mt-6">
        <ContextImagesClient
          projectId={projectId}
          basketId={basketId}
        />
      </TabsContent>
    </Tabs>
  );
}

// Export separate component for Add Context button to be used in header
export { default as AddContextButton } from "./AddContextButton";
