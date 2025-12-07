'use client';

/**
 * DockItem
 *
 * Individual item in the top dock bar.
 * Shows icon, label, badge count, and pulse indicator.
 *
 * Part of Desktop UI Architecture v1.0
 * See: /docs/implementation/DESKTOP_UI_IMPLEMENTATION_PLAN.md
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useDesktop, type WindowId } from './DesktopProvider';

interface DockItemProps {
  windowId: WindowId;
  icon: ReactNode;
  label: string;
}

export function DockItem({ windowId, icon, label }: DockItemProps) {
  const { openWindow, isWindowOpen, getBadge, isPulsing } = useDesktop();

  const isActive = isWindowOpen(windowId);
  const badge = getBadge(windowId);
  const pulse = isPulsing(windowId);

  return (
    <button
      onClick={() => openWindow(windowId)}
      className={cn(
        'relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-md',
        'text-xs font-medium transition-all duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
      aria-pressed={isActive}
      aria-label={`${label}${badge ? ` (${badge})` : ''}`}
    >
      <div className="relative">
        {/* Icon */}
        <span className="block h-4 w-4">{icon}</span>

        {/* Badge */}
        {badge !== undefined && badge > 0 && (
          <span
            className={cn(
              'absolute -right-1.5 -top-1.5',
              'flex h-4 min-w-4 items-center justify-center',
              'rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground'
            )}
          >
            {badge > 9 ? '9+' : badge}
          </span>
        )}

        {/* Pulse indicator */}
        {pulse && !badge && (
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5',
              'h-2 w-2 rounded-full bg-amber-500',
              'animate-pulse'
            )}
          />
        )}
      </div>

      {/* Label */}
      <span className="text-[11px]">{label}</span>

      {/* Active indicator line */}
      {isActive && (
        <span
          className={cn(
            'absolute bottom-0 left-1/2 -translate-x-1/2',
            'h-0.5 w-6 rounded-full bg-primary'
          )}
        />
      )}
    </button>
  );
}

export default DockItem;
