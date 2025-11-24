/**
 * Project-level navigation sections
 * Defines the tabs/sections visible when viewing a project
 */

import {
  MessageSquare,
  Layers,
  Clock,
  Settings,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";

export type ProjectSection = {
  key: string;
  label: string;
  icon: LucideIcon;
  href: (projectId: string) => string;
  description?: string;
};

export const PROJECT_SECTIONS: ProjectSection[] = [
  {
    key: "chat",
    label: "Chat",
    icon: MessageSquare,
    href: (id) => `/projects/${id}`,
    description: "Thinking Partner - orchestrate research, content, and reports",
  },
  {
    key: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    href: (id) => `/projects/${id}/overview`,
    description: "Project dashboard with key metrics and status",
  },
  {
    key: "context",
    label: "Context",
    icon: Layers,
    href: (id) => `/projects/${id}/context`,
    description: "Manage knowledge base and context items",
  },
  {
    key: "work-tickets",
    label: "Work Tickets",
    icon: Clock,
    href: (id) => `/projects/${id}/work-tickets-view`,
    description: "View and manage agent work tickets",
  },
  {
    key: "settings",
    label: "Settings",
    icon: Settings,
    href: (id) => `/projects/${id}/settings`,
    description: "Project settings and basket management",
  },
];

export const SECTION_ORDER: ProjectSection[] = PROJECT_SECTIONS;

/**
 * Get section by key
 */
export function getSection(key: string): ProjectSection | undefined {
  return PROJECT_SECTIONS.find((s) => s.key === key);
}

/**
 * Get section by path
 */
export function getSectionByPath(path: string): ProjectSection | undefined {
  return PROJECT_SECTIONS.find((s) => path.includes(`/${s.key}`));
}
