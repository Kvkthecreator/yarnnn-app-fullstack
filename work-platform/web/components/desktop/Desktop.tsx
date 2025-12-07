'use client';

/**
 * Desktop
 *
 * Main container for the Desktop UI system.
 * Chat as wallpaper with floating windows overlay.
 *
 * Structure:
 * - Top Dock (always visible)
 * - Chat content (wallpaper, always full-width)
 * - Floating windows (overlay on top when open)
 *
 * Part of Desktop UI Architecture v1.0
 * See: /docs/implementation/DESKTOP_UI_IMPLEMENTATION_PLAN.md
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Dock } from './Dock';
import { Window } from './Window';
import { ContextWindowContent } from './windows/ContextWindowContent';
import { WorkWindowContent } from './windows/WorkWindowContent';
import { OutputsWindowContent } from './windows/OutputsWindowContent';
import { RecipesWindowContent } from './windows/RecipesWindowContent';
import { ScheduleWindowContent } from './windows/ScheduleWindowContent';
import {
  FileText,
  Zap,
  Lightbulb,
  Target,
  Calendar,
} from 'lucide-react';

interface DesktopProps {
  children: ReactNode; // Chat interface
  className?: string;
}

export function Desktop({ children, className }: DesktopProps) {
  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Top Dock */}
      <Dock />

      {/* Chat Wallpaper (always full-width) */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>

      {/* Floating Windows (overlay) */}
      <Window
        windowId="context"
        title="Context"
        icon={<FileText className="h-4 w-4" />}
      >
        <ContextWindowContent />
      </Window>

      <Window
        windowId="work"
        title="Work"
        icon={<Zap className="h-4 w-4" />}
      >
        <WorkWindowContent />
      </Window>

      <Window
        windowId="outputs"
        title="Outputs"
        icon={<Lightbulb className="h-4 w-4" />}
      >
        <OutputsWindowContent />
      </Window>

      <Window
        windowId="recipes"
        title="Recipes"
        icon={<Target className="h-4 w-4" />}
      >
        <RecipesWindowContent />
      </Window>

      <Window
        windowId="schedule"
        title="Schedule"
        icon={<Calendar className="h-4 w-4" />}
      >
        <ScheduleWindowContent />
      </Window>
    </div>
  );
}

export default Desktop;
