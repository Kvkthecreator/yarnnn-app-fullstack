"use client";

/**
 * ThinkingAgentClient - Dedicated TP Page
 *
 * Desktop UI layout for Thinking Partner with floating windows.
 * Refactored to use Desktop UI architecture (chat as wallpaper + floating windows).
 *
 * Layout:
 * - Chat is always full-width (wallpaper)
 * - Top dock with window icons (Context, Work, Outputs, Recipes, Schedule)
 * - Floating windows overlay on top when opened
 *
 * See: /docs/implementation/DESKTOP_UI_IMPLEMENTATION_PLAN.md
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TPChatInterface } from '@/components/thinking/TPChatInterface';
import { DesktopProvider, Desktop, useDesktop } from '@/components/desktop';
import type { TPPhase, TPContextChange, WorkOutput } from '@/lib/types/thinking-partner';
import { useTPRealtimeEnhanced } from '@/hooks/useTPRealtimeEnhanced';
import { AGENT_CONFIG } from '../config';
import { cn } from '@/lib/utils';

interface ThinkingAgentClientProps {
  project: {
    id: string;
    name: string;
  };
  basketId: string;
  workspaceId: string;
}

export function ThinkingAgentClient({
  project,
  basketId,
  workspaceId,
}: ThinkingAgentClientProps) {
  const router = useRouter();
  const config = AGENT_CONFIG.thinking;

  // Realtime updates for header badges
  const {
    isConnected,
    activeTickets,
    pendingOutputs,
  } = useTPRealtimeEnhanced({
    basketId,
  });

  return (
    <DesktopProvider basketId={basketId}>
      <div className="flex h-full flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <config.icon className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold">{config.label}</h1>
              <p className="text-xs text-muted-foreground">{project.name}</p>
            </div>
            <Badge variant="outline" className="border-primary/40 text-primary">
              Interactive
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {isConnected && (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <span className="mr-1.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Live
              </Badge>
            )}
            {activeTickets.length > 0 && (
              <Badge variant="secondary">
                {activeTickets.length} Active
              </Badge>
            )}
            {pendingOutputs.length > 0 && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                {pendingOutputs.length} Pending
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/projects/${project.id}/work-tickets-view`)}
            >
              View All Tickets
            </Button>
          </div>
        </header>

        {/* Desktop UI - Chat as wallpaper with floating windows */}
        <div className="flex-1 overflow-hidden">
          <Desktop>
            <TPChatInterface
              basketId={basketId}
              workspaceId={workspaceId}
              className="h-full"
            />
          </Desktop>
        </div>
      </div>
    </DesktopProvider>
  );
}

export default ThinkingAgentClient;
