'use client';

/**
 * Window
 *
 * Floating window component that appears centered over the chat.
 * Includes header with title, minimize, and close buttons.
 *
 * Part of Desktop UI Architecture v1.0
 * See: /docs/implementation/DESKTOP_UI_IMPLEMENTATION_PLAN.md
 */

import { useEffect, useCallback, type ReactNode } from 'react';
import { X, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { WindowBackdrop } from './WindowBackdrop';
import { useDesktop, type WindowId } from './DesktopProvider';

interface WindowProps {
  windowId: WindowId;
  title: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Window({
  windowId,
  title,
  icon,
  children,
  className,
}: WindowProps) {
  const { closeWindow, isWindowOpen } = useDesktop();

  const isOpen = isWindowOpen(windowId);

  // Handle escape key to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeWindow(windowId);
      }
    },
    [isOpen, closeWindow, windowId]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        className
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`window-title-${windowId}`}
    >
      {/* Backdrop */}
      <WindowBackdrop onClick={() => closeWindow(windowId)} />

      {/* Window */}
      <div
        className={cn(
          'relative z-10 w-full max-w-2xl max-h-[80vh]',
          'bg-card rounded-lg border border-border shadow-xl',
          'flex flex-col overflow-hidden',
          // Animation
          'animate-in fade-in zoom-in-95 duration-200'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{icon}</span>
            <h2
              id={`window-title-${windowId}`}
              className="font-semibold text-foreground"
            >
              {title}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {/* Minimize (closes for now - same behavior) */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => closeWindow(windowId)}
              className="h-8 w-8 p-0 hover:bg-muted"
              aria-label="Minimize window"
            >
              <Minus className="h-4 w-4" />
            </Button>
            {/* Close */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => closeWindow(windowId)}
              className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
              aria-label="Close window"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

export default Window;
