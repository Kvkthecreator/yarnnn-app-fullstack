'use client';

/**
 * Dock
 *
 * Top dock bar with window icons, badges, and quick access.
 * Located at top of screen (not bottom) to avoid OS dock conflicts.
 *
 * Part of Desktop UI Architecture v1.0
 * See: /docs/implementation/DESKTOP_UI_IMPLEMENTATION_PLAN.md
 */

import {
  FileText,
  Zap,
  Lightbulb,
  Target,
  Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DockItem } from './DockItem';
import type { WindowId } from './DesktopProvider';

// Dock configuration
const DOCK_ITEMS: Array<{
  id: WindowId;
  icon: React.ReactNode;
  label: string;
}> = [
  {
    id: 'context',
    icon: <FileText className="h-4 w-4" />,
    label: 'Context',
  },
  {
    id: 'work',
    icon: <Zap className="h-4 w-4" />,
    label: 'Work',
  },
  {
    id: 'outputs',
    icon: <Lightbulb className="h-4 w-4" />,
    label: 'Outputs',
  },
  {
    id: 'recipes',
    icon: <Target className="h-4 w-4" />,
    label: 'Recipes',
  },
  {
    id: 'schedule',
    icon: <Calendar className="h-4 w-4" />,
    label: 'Schedule',
  },
];

interface DockProps {
  className?: string;
}

export function Dock({ className }: DockProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 border-b border-border bg-muted/30 px-3 py-2',
        className
      )}
      role="toolbar"
      aria-label="Desktop dock"
    >
      {DOCK_ITEMS.map((item) => (
        <DockItem
          key={item.id}
          windowId={item.id}
          icon={item.icon}
          label={item.label}
        />
      ))}
    </div>
  );
}

export default Dock;
