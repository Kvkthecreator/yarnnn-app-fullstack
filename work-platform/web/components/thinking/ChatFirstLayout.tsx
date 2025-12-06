'use client';

/**
 * ChatFirstLayout
 *
 * Primary layout for chat-first architecture.
 * TP chat is the main interface, with sliding detail panels for context/outputs.
 *
 * Layout Modes:
 * - Desktop: Chat (60%) + Detail Panel (40%) - resizable
 * - Tablet: Chat full-width + slide-out panel
 * - Mobile: Chat full-screen + modal panel
 *
 * Part of Chat-First Architecture v1.0
 * See: /docs/architecture/CHAT_FIRST_ARCHITECTURE_V1.md
 */

import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  X,
  Maximize2,
  Minimize2,
  ChevronRight,
  ChevronLeft,
  FileText,
  Lightbulb,
  ClipboardList,
  Home,
  GripVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

// Detail panel tab types
export type DetailTab = 'context' | 'outputs' | 'tickets' | 'overview';

interface DetailPanelState {
  isOpen: boolean;
  activeTab: DetailTab;
  itemId?: string; // Specific item to focus on
  isMaximized?: boolean;
}

interface ChatFirstLayoutProps {
  // Main chat content
  children: ReactNode;

  // Detail panel content by tab
  contextPanel?: ReactNode;
  outputsPanel?: ReactNode;
  ticketsPanel?: ReactNode;
  overviewPanel?: ReactNode;

  // Navigation callbacks
  onNavigateToContext?: (itemId?: string) => void;
  onNavigateToOutput?: (outputId?: string) => void;
  onNavigateToTicket?: (ticketId?: string) => void;

  // Initial state
  initialDetailTab?: DetailTab;
  initialDetailOpen?: boolean;

  className?: string;
}

// ============================================================================
// Detail Panel Header
// ============================================================================

interface DetailPanelHeaderProps {
  tabs: Array<{ id: DetailTab; label: string; icon: React.ElementType }>;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onClose: () => void;
  onToggleMaximize?: () => void;
  isMaximized?: boolean;
  showBackButton?: boolean;
}

function DetailPanelHeader({
  tabs,
  activeTab,
  onTabChange,
  onClose,
  onToggleMaximize,
  isMaximized,
  showBackButton,
}: DetailPanelHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-card/80 backdrop-blur px-3 py-2">
      {/* Tabs */}
      <div className="flex items-center gap-1">
        {showBackButton && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-7 px-2 mr-2"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        )}

        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          return (
            <Button
              key={tab.id}
              variant={isActive ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'h-7 px-2 text-xs',
                isActive && 'bg-primary/10 text-primary'
              )}
            >
              <Icon className="h-3.5 w-3.5 mr-1" />
              {tab.label}
            </Button>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        {onToggleMaximize && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleMaximize}
            className="h-7 w-7 p-0"
          >
            {isMaximized ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        )}

        {!showBackButton && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-7 w-7 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Context for accessing layout actions from children
// ============================================================================

import { createContext, useContext, useMemo } from 'react';

interface ChatFirstLayoutContextValue {
  openDetailPanel: (tab: DetailTab, itemId?: string) => void;
  closeDetailPanel: () => void;
}

const ChatFirstLayoutContext = createContext<ChatFirstLayoutContextValue | null>(null);

export function useChatFirstLayout() {
  const context = useContext(ChatFirstLayoutContext);
  if (!context) {
    // Return no-op functions if not within layout
    return {
      openDetailPanel: () => {},
      closeDetailPanel: () => {},
    };
  }
  return context;
}

// Internal wrapper to provide context within ChatFirstLayout
function ChatFirstLayoutWithContext({
  children,
  contextPanel,
  outputsPanel,
  ticketsPanel,
  overviewPanel,
  onNavigateToContext,
  onNavigateToOutput,
  onNavigateToTicket,
  initialDetailTab = 'overview',
  initialDetailOpen = false,
  className,
}: ChatFirstLayoutProps) {
  const [layoutMode, setLayoutMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [detailState, setDetailState] = useState<DetailPanelState>({
    isOpen: initialDetailOpen,
    activeTab: initialDetailTab,
    isMaximized: false,
  });
  const [panelWidth, setPanelWidth] = useState(40);
  const [isResizing, setIsResizing] = useState(false);

  // Detect layout mode
  useEffect(() => {
    const checkLayoutMode = () => {
      const width = window.innerWidth;
      if (width >= 1280) {
        setLayoutMode('desktop');
      } else if (width >= 768) {
        setLayoutMode('tablet');
      } else {
        setLayoutMode('mobile');
      }
    };

    checkLayoutMode();
    window.addEventListener('resize', checkLayoutMode);
    return () => window.removeEventListener('resize', checkLayoutMode);
  }, []);

  // Open detail panel with specific tab and optional item
  const openDetailPanel = useCallback((tab: DetailTab, itemId?: string) => {
    setDetailState({
      isOpen: true,
      activeTab: tab,
      itemId,
      isMaximized: false,
    });

    // Trigger navigation callbacks
    if (tab === 'context' && onNavigateToContext) {
      onNavigateToContext(itemId);
    } else if (tab === 'outputs' && onNavigateToOutput) {
      onNavigateToOutput(itemId);
    } else if (tab === 'tickets' && onNavigateToTicket) {
      onNavigateToTicket(itemId);
    }
  }, [onNavigateToContext, onNavigateToOutput, onNavigateToTicket]);

  // Close detail panel
  const closeDetailPanel = useCallback(() => {
    setDetailState((prev) => ({
      ...prev,
      isOpen: false,
      itemId: undefined,
    }));
  }, []);

  // Toggle maximize
  const toggleMaximize = useCallback(() => {
    setDetailState((prev) => ({
      ...prev,
      isMaximized: !prev.isMaximized,
    }));
  }, []);

  // Tab change
  const handleTabChange = useCallback((tab: DetailTab) => {
    setDetailState((prev) => ({
      ...prev,
      activeTab: tab,
      itemId: undefined,
    }));
  }, []);

  // Handle resize drag
  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const containerWidth = window.innerWidth;
      const newWidth = ((containerWidth - e.clientX) / containerWidth) * 100;
      setPanelWidth(Math.min(65, Math.max(25, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Tab configuration
  const tabs: Array<{ id: DetailTab; label: string; icon: React.ElementType; content?: ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: Home, content: overviewPanel },
    { id: 'context', label: 'Context', icon: FileText, content: contextPanel },
    { id: 'outputs', label: 'Outputs', icon: Lightbulb, content: outputsPanel },
    { id: 'tickets', label: 'Tickets', icon: ClipboardList, content: ticketsPanel },
  ];

  const activeTabContent = tabs.find((t) => t.id === detailState.activeTab)?.content;

  // Context value for children
  const contextValue = useMemo<ChatFirstLayoutContextValue>(() => ({
    openDetailPanel,
    closeDetailPanel,
  }), [openDetailPanel, closeDetailPanel]);

  // Render based on layout mode
  const renderLayout = () => {
    // Desktop layout
    if (layoutMode === 'desktop') {
      return (
        <div className={cn('flex h-full w-full', className)}>
          {/* Chat panel - primary */}
          <div
            className={cn(
              'flex flex-col overflow-hidden transition-all duration-200',
              detailState.isMaximized && 'hidden'
            )}
            style={{
              width: detailState.isOpen && !detailState.isMaximized
                ? `${100 - panelWidth}%`
                : '100%',
            }}
          >
            {/* Quick access bar when panel is closed */}
            {!detailState.isOpen && (
              <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2 py-1">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <Button
                      key={tab.id}
                      variant="ghost"
                      size="sm"
                      onClick={() => openDetailPanel(tab.id)}
                      className="h-7 px-2 text-xs"
                    >
                      <Icon className="h-3.5 w-3.5 mr-1" />
                      {tab.label}
                    </Button>
                  );
                })}
              </div>
            )}

            {/* Main chat content */}
            <div className="flex-1 overflow-hidden">
              {children}
            </div>
          </div>

          {/* Resize handle */}
          {detailState.isOpen && !detailState.isMaximized && (
            <div
              className={cn(
                'w-1 cursor-col-resize bg-border hover:bg-primary/50 transition-colors',
                isResizing && 'bg-primary'
              )}
              onMouseDown={handleResizeStart}
            >
              <div className="flex h-full items-center justify-center">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          )}

          {/* Detail panel */}
          {detailState.isOpen && (
            <div
              className={cn(
                'flex flex-col border-l border-border bg-card',
                detailState.isMaximized ? 'w-full' : ''
              )}
              style={{
                width: detailState.isMaximized ? '100%' : `${panelWidth}%`,
              }}
            >
              <DetailPanelHeader
                tabs={tabs}
                activeTab={detailState.activeTab}
                onTabChange={handleTabChange}
                onClose={closeDetailPanel}
                onToggleMaximize={toggleMaximize}
                isMaximized={detailState.isMaximized}
              />

              <div className="flex-1 overflow-hidden">
                {activeTabContent || (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    No content for this tab
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Tablet layout - slide out panel
    if (layoutMode === 'tablet') {
      return (
        <div className={cn('relative h-full w-full', className)}>
          {/* Main chat */}
          <div className="h-full w-full">
            {/* Quick access bar */}
            <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
              <span className="text-sm font-medium">Thinking Partner</span>
              <div className="flex items-center gap-1">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <Button
                      key={tab.id}
                      variant={detailState.isOpen && detailState.activeTab === tab.id ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => openDetailPanel(tab.id)}
                      className="h-7 w-7 p-0"
                    >
                      <Icon className="h-4 w-4" />
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="h-[calc(100%-44px)] overflow-hidden">
              {children}
            </div>
          </div>

          {/* Slide-out detail panel */}
          {detailState.isOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40 bg-black/40"
                onClick={closeDetailPanel}
              />

              {/* Panel */}
              <div className="fixed right-0 top-0 z-50 h-full w-full max-w-lg border-l border-border bg-card shadow-xl">
                <DetailPanelHeader
                  tabs={tabs}
                  activeTab={detailState.activeTab}
                  onTabChange={handleTabChange}
                  onClose={closeDetailPanel}
                  isMaximized={false}
                />

                <div className="h-[calc(100%-52px)] overflow-hidden">
                  {activeTabContent || (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      No content for this tab
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      );
    }

    // Mobile layout - modal panel
    return (
      <div className={cn('relative h-full w-full', className)}>
        {/* Main chat */}
        <div className={cn('h-full w-full', detailState.isOpen && 'hidden')}>
          {/* Quick access bar */}
          <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
            <span className="text-sm font-medium">TP</span>
            <div className="flex items-center gap-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <Button
                    key={tab.id}
                    variant="ghost"
                    size="sm"
                    onClick={() => openDetailPanel(tab.id)}
                    className="h-8 w-8 p-0"
                  >
                    <Icon className="h-4 w-4" />
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="h-[calc(100%-44px)] overflow-hidden">
            {children}
          </div>
        </div>

        {/* Full-screen detail panel on mobile */}
        {detailState.isOpen && (
          <div className="fixed inset-0 z-50 bg-card">
            <DetailPanelHeader
              tabs={tabs}
              activeTab={detailState.activeTab}
              onTabChange={handleTabChange}
              onClose={closeDetailPanel}
              isMaximized={false}
              showBackButton
            />

            <div className="h-[calc(100%-52px)] overflow-hidden">
              {activeTabContent || (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  No content for this tab
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <ChatFirstLayoutContext.Provider value={contextValue}>
      {renderLayout()}
    </ChatFirstLayoutContext.Provider>
  );
}

// Main export - wraps with context
export function ChatFirstLayout(props: ChatFirstLayoutProps) {
  return <ChatFirstLayoutWithContext {...props} />;
}

// Alias for backwards compatibility
export const ChatFirstLayoutProvider = ChatFirstLayout;

export default ChatFirstLayout;
