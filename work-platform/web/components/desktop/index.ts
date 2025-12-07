/**
 * Desktop UI Components
 *
 * Chat-as-wallpaper with floating windows architecture.
 *
 * Part of Desktop UI Architecture v1.0
 * See: /docs/implementation/DESKTOP_UI_IMPLEMENTATION_PLAN.md
 */

// Core components
export { DesktopProvider, useDesktop, useBasketId } from './DesktopProvider';
export type { WindowId, WindowState, WindowHighlight, DockItemState, DesktopState } from './DesktopProvider';
export { Desktop } from './Desktop';
export { Dock } from './Dock';
export { DockItem } from './DockItem';
export { Window } from './Window';
export { WindowBackdrop } from './WindowBackdrop';

// Window content components
export { ContextWindowContent } from './windows/ContextWindowContent';
export { WorkWindowContent } from './windows/WorkWindowContent';
export { OutputsWindowContent } from './windows/OutputsWindowContent';
export { RecipesWindowContent } from './windows/RecipesWindowContent';
export { ScheduleWindowContent } from './windows/ScheduleWindowContent';
