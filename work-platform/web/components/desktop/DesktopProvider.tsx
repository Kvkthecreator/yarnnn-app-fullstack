'use client';

/**
 * DesktopProvider
 *
 * React Context and state management for the Desktop UI system.
 * Manages floating windows, dock state, badges, and highlights.
 *
 * Part of Desktop UI Architecture v1.0
 * See: /docs/implementation/DESKTOP_UI_IMPLEMENTATION_PLAN.md
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

// ============================================================================
// Types
// ============================================================================

export type WindowId = 'context' | 'work' | 'outputs' | 'recipes' | 'schedule';

export interface WindowHighlight {
  itemIds?: string[];
  action?: 'reading' | 'writing' | 'using';
}

export interface WindowState {
  isOpen: boolean;
  highlight?: WindowHighlight;
}

export interface DockItemState {
  badge?: number;
  pulse?: boolean;
}

export interface DesktopState {
  windows: Record<WindowId, WindowState>;
  dock: Record<WindowId, DockItemState>;
  activeWindow: WindowId | null;
}

// ============================================================================
// Actions
// ============================================================================

export type DesktopAction =
  | { type: 'OPEN_WINDOW'; windowId: WindowId; highlight?: WindowHighlight }
  | { type: 'CLOSE_WINDOW'; windowId: WindowId }
  | { type: 'CLOSE_ALL_WINDOWS' }
  | { type: 'SET_HIGHLIGHT'; windowId: WindowId; highlight: WindowHighlight }
  | { type: 'CLEAR_HIGHLIGHT'; windowId: WindowId }
  | { type: 'SET_BADGE'; windowId: WindowId; badge: number }
  | { type: 'INCREMENT_BADGE'; windowId: WindowId }
  | { type: 'CLEAR_BADGE'; windowId: WindowId }
  | { type: 'SET_PULSE'; windowId: WindowId; pulse: boolean };

// ============================================================================
// Initial State
// ============================================================================

const WINDOW_IDS: WindowId[] = ['context', 'work', 'outputs', 'recipes', 'schedule'];

function createInitialState(): DesktopState {
  const windows: Record<WindowId, WindowState> = {} as Record<WindowId, WindowState>;
  const dock: Record<WindowId, DockItemState> = {} as Record<WindowId, DockItemState>;

  for (const id of WINDOW_IDS) {
    windows[id] = { isOpen: false };
    dock[id] = {};
  }

  return {
    windows,
    dock,
    activeWindow: null,
  };
}

// ============================================================================
// Reducer
// ============================================================================

function desktopReducer(state: DesktopState, action: DesktopAction): DesktopState {
  switch (action.type) {
    case 'OPEN_WINDOW': {
      // Close all other windows (single window mode)
      const newWindows: Record<WindowId, WindowState> = {} as Record<WindowId, WindowState>;
      for (const id of WINDOW_IDS) {
        newWindows[id] = {
          isOpen: id === action.windowId,
          highlight: id === action.windowId ? action.highlight : undefined,
        };
      }

      return {
        ...state,
        activeWindow: action.windowId,
        windows: newWindows,
        dock: {
          ...state.dock,
          [action.windowId]: {
            ...state.dock[action.windowId],
            pulse: false, // Clear pulse when window is opened
          },
        },
      };
    }

    case 'CLOSE_WINDOW': {
      return {
        ...state,
        activeWindow: state.activeWindow === action.windowId ? null : state.activeWindow,
        windows: {
          ...state.windows,
          [action.windowId]: {
            ...state.windows[action.windowId],
            isOpen: false,
          },
        },
      };
    }

    case 'CLOSE_ALL_WINDOWS': {
      const newWindows: Record<WindowId, WindowState> = {} as Record<WindowId, WindowState>;
      for (const id of WINDOW_IDS) {
        newWindows[id] = { isOpen: false };
      }
      return {
        ...state,
        activeWindow: null,
        windows: newWindows,
      };
    }

    case 'SET_HIGHLIGHT': {
      return {
        ...state,
        windows: {
          ...state.windows,
          [action.windowId]: {
            ...state.windows[action.windowId],
            highlight: action.highlight,
          },
        },
      };
    }

    case 'CLEAR_HIGHLIGHT': {
      return {
        ...state,
        windows: {
          ...state.windows,
          [action.windowId]: {
            ...state.windows[action.windowId],
            highlight: undefined,
          },
        },
      };
    }

    case 'SET_BADGE': {
      return {
        ...state,
        dock: {
          ...state.dock,
          [action.windowId]: {
            ...state.dock[action.windowId],
            badge: action.badge,
          },
        },
      };
    }

    case 'INCREMENT_BADGE': {
      const currentBadge = state.dock[action.windowId].badge || 0;
      return {
        ...state,
        dock: {
          ...state.dock,
          [action.windowId]: {
            ...state.dock[action.windowId],
            badge: currentBadge + 1,
          },
        },
      };
    }

    case 'CLEAR_BADGE': {
      return {
        ...state,
        dock: {
          ...state.dock,
          [action.windowId]: {
            ...state.dock[action.windowId],
            badge: undefined,
          },
        },
      };
    }

    case 'SET_PULSE': {
      return {
        ...state,
        dock: {
          ...state.dock,
          [action.windowId]: {
            ...state.dock[action.windowId],
            pulse: action.pulse,
          },
        },
      };
    }

    default:
      return state;
  }
}

// ============================================================================
// Context
// ============================================================================

interface DesktopContextValue {
  state: DesktopState;
  dispatch: React.Dispatch<DesktopAction>;
}

const DesktopContext = createContext<DesktopContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface DesktopProviderProps {
  children: ReactNode;
  basketId?: string; // For data fetching in window contents
}

export function DesktopProvider({ children, basketId }: DesktopProviderProps) {
  const [state, dispatch] = useReducer(desktopReducer, null, createInitialState);

  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);

  return (
    <DesktopContext.Provider value={value}>
      <BasketIdContext.Provider value={basketId}>
        {children}
      </BasketIdContext.Provider>
    </DesktopContext.Provider>
  );
}

// Separate context for basketId to avoid re-renders
const BasketIdContext = createContext<string | undefined>(undefined);

export function useBasketId() {
  return useContext(BasketIdContext);
}

// ============================================================================
// Hook
// ============================================================================

export function useDesktopContext() {
  const context = useContext(DesktopContext);
  if (!context) {
    throw new Error('useDesktopContext must be used within DesktopProvider');
  }
  return context;
}

// ============================================================================
// Convenience Hook with Actions
// ============================================================================

export function useDesktop() {
  const { state, dispatch } = useDesktopContext();

  // Window actions
  const openWindow = useCallback(
    (windowId: WindowId, highlight?: WindowHighlight) => {
      dispatch({ type: 'OPEN_WINDOW', windowId, highlight });
    },
    [dispatch]
  );

  const closeWindow = useCallback(
    (windowId: WindowId) => {
      dispatch({ type: 'CLOSE_WINDOW', windowId });
    },
    [dispatch]
  );

  const closeAllWindows = useCallback(() => {
    dispatch({ type: 'CLOSE_ALL_WINDOWS' });
  }, [dispatch]);

  const setHighlight = useCallback(
    (windowId: WindowId, highlight: WindowHighlight) => {
      dispatch({ type: 'SET_HIGHLIGHT', windowId, highlight });
    },
    [dispatch]
  );

  const clearHighlight = useCallback(
    (windowId: WindowId) => {
      dispatch({ type: 'CLEAR_HIGHLIGHT', windowId });
    },
    [dispatch]
  );

  // Dock actions
  const setBadge = useCallback(
    (windowId: WindowId, badge: number) => {
      dispatch({ type: 'SET_BADGE', windowId, badge });
    },
    [dispatch]
  );

  const incrementBadge = useCallback(
    (windowId: WindowId) => {
      dispatch({ type: 'INCREMENT_BADGE', windowId });
    },
    [dispatch]
  );

  const clearBadge = useCallback(
    (windowId: WindowId) => {
      dispatch({ type: 'CLEAR_BADGE', windowId });
    },
    [dispatch]
  );

  const setPulse = useCallback(
    (windowId: WindowId, pulse: boolean) => {
      dispatch({ type: 'SET_PULSE', windowId, pulse });
    },
    [dispatch]
  );

  // State accessors
  const isWindowOpen = useCallback(
    (windowId: WindowId) => state.windows[windowId]?.isOpen ?? false,
    [state.windows]
  );

  const getHighlight = useCallback(
    (windowId: WindowId) => state.windows[windowId]?.highlight,
    [state.windows]
  );

  const getBadge = useCallback(
    (windowId: WindowId) => state.dock[windowId]?.badge,
    [state.dock]
  );

  const isPulsing = useCallback(
    (windowId: WindowId) => state.dock[windowId]?.pulse ?? false,
    [state.dock]
  );

  return {
    // State
    activeWindow: state.activeWindow,
    windows: state.windows,
    dock: state.dock,

    // Window actions
    openWindow,
    closeWindow,
    closeAllWindows,
    setHighlight,
    clearHighlight,

    // Dock actions
    setBadge,
    incrementBadge,
    clearBadge,
    setPulse,

    // State accessors
    isWindowOpen,
    getHighlight,
    getBadge,
    isPulsing,
  };
}

export default DesktopProvider;
