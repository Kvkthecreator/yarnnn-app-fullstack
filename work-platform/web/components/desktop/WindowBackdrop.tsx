'use client';

/**
 * WindowBackdrop
 *
 * Semi-transparent backdrop behind floating windows.
 * Click to close the active window.
 *
 * Part of Desktop UI Architecture v1.0
 * See: /docs/implementation/DESKTOP_UI_IMPLEMENTATION_PLAN.md
 */

import { cn } from '@/lib/utils';

interface WindowBackdropProps {
  onClick: () => void;
  className?: string;
}

export function WindowBackdrop({ onClick, className }: WindowBackdropProps) {
  return (
    <div
      className={cn(
        'fixed inset-0 bg-black/40 backdrop-blur-sm',
        'animate-in fade-in duration-200',
        className
      )}
      onClick={onClick}
      aria-hidden="true"
    />
  );
}

export default WindowBackdrop;
