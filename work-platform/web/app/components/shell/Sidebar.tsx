"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Inbox, LogOut, Settings2, FileText, Clock, Brain, Network, Layers, BookOpen, Shield, CloudUpload, ArrowLeft, PenSquare, BarChart3, MessageSquare, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import { createBrowserClient } from "@/lib/supabase/clients";
import { getAllProjects } from "@/lib/projects/getAllProjects";
import type { ProjectOverview } from "@/lib/projects/getAllProjects";
import SidebarToggleIcon from "@/components/icons/SidebarToggleIcon";
import { useNavState } from "@/components/nav/useNavState";
import SidebarItem from "@/components/nav/SidebarItem";
import { SECTION_ORDER } from "@/components/features/projects/sections";

interface SidebarProps {
  className?: string;
}

const supabase = createBrowserClient();

const GLOBAL_LINKS = [
  {
    href: '/dashboard',
    label: 'Control Tower',
    icon: LayoutDashboard,
  },
  {
    href: '/projects',
    label: 'Projects',
    icon: BookOpen,
  },
];

const AGENT_LINKS = [
  {
    key: 'thinking',
    label: 'Thinking Partner',
    icon: MessageSquare,
  },
  {
    key: 'research',
    label: 'Research Agent',
    icon: Brain,
  },
  {
    key: 'content',
    label: 'Content Agent',
    icon: PenSquare,
  },
  {
    key: 'reporting',
    label: 'Reporting Agent',
    icon: BarChart3,
  },
];

export default function Sidebar({ className }: SidebarProps) {
  const { open, setOpen, toggle } = useNavState();
  const pathname = usePathname();
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectOverview | null>(null);
  const [projectList, setProjectList] = useState<ProjectOverview[]>([]);
  const [openDropdown, setOpenDropdown] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // Mobile detection and responsive behavior
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      const wasMobile = isMobile;
      setIsMobile(mobile);

      // When switching from desktop to mobile, close sidebar to avoid covering content
      if (mobile && !wasMobile && open) {
        setOpen(false);
      }
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, [isMobile, open, setOpen]);

  useEffect(() => {
    async function init() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setUserEmail(user?.email || null);

        const data = await getAllProjects();
        setProjectList(data);

        const idFromPath = pathname?.match(/^\/projects\/([^/]+)/)?.[1];
        if (idFromPath) {
          const fallback = data.find((item) => item.id === idFromPath);
          if (fallback) {
            setProject(fallback);
          } else {
            setProject({
              id: idFromPath,
              name: 'Untitled Project',
              description: null,
              created_at: new Date().toISOString(),
            } as ProjectOverview);
          }
        } else {
          setProject(null);
        }
      } catch (err) {
        console.error("❌ Sidebar: Init error:", err);
        setProject(null);
        setProjectList([]);
      }
    }
    init();
  }, [pathname]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (openDropdown && dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(false);
      }

      if (isMobile && open && !(e.target as HTMLElement).closest(".sidebar")) {
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [openDropdown, isMobile, open, setOpen]);

  useEffect(() => {
    if (!isMobile) return;
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobile, open]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };


  const handleNavigateToSettings = () => {
    try {
      router.push("/dashboard/settings");
      // Close sidebar on mobile after navigation
      if (isMobile) {
        setOpen(false);
      }
    } catch (error) {
      console.error("❌ Sidebar: Failed to navigate to settings:", error);
    }
  };

  const activeProjectId = pathname?.match(/^\/projects\/([^/]+)/)?.[1] || null;
  const projectId = activeProjectId || project?.id;
  const isProjectDetail = Boolean(activeProjectId);

  // Map section keys to icons
  const sectionIcons: Record<string, React.ElementType> = {
    overview: LayoutDashboard,
    context: Layers,
    "work-tickets": Briefcase,
    settings: Settings2,
    reports: FileText,
  };

  return (
    <>
      {/* Scrim for mobile when sidebar is open */}
      {isMobile && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className={cn(
            "fixed inset-0 z-[49] bg-black/40 transition-opacity md:hidden",
            open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
          )}
        />
      )}

      <aside
        id="global-sidebar"
        className={cn(
          "sidebar h-screen w-64 border-r border-border transition-transform duration-300 flex flex-col z-[50]",
          isMobile ? "fixed top-0 left-0 bg-background/95 backdrop-blur-md shadow-xl" : "relative bg-card",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          !open && !isMobile && "hidden",
          className,
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "sticky top-0 z-10 flex h-12 items-center justify-center border-b px-4",
            "bg-background/95 backdrop-blur-md",
          )}
        >
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              router.push("/");
            }}
            className="text-xl tracking-tight hover:underline font-brand"
          >
            yarnnn
          </button>
        </div>

        {/* Navigation */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {isProjectDetail && project ? (
            <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6">
              <button
                onClick={() => {
                  router.push('/dashboard');
                  if (isMobile) setOpen(false);
                }}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft size={14} /> Back to Dashboard
              </button>
              <section className="space-y-2">
                <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Current Project
                </div>
                <div className="rounded-md border-2 border-primary/40 bg-primary/5 px-3 py-2.5 text-sm font-semibold text-foreground shadow-sm">
                  {project.name || 'Untitled Project'}
                </div>
                <div className="flex flex-col gap-0.5 pt-2">
                  {SECTION_ORDER.map((section) => {
                    const href = section.href(project.id);
                    const Icon = sectionIcons[section.key];
                    return (
                      <SidebarItem
                        key={section.key}
                        href={href}
                        onClick={() => {
                          if (isMobile) setOpen(false);
                        }}
                      >
                        <span className="flex items-center gap-2">
                          {Icon && <Icon size={14} />}
                          {section.label}
                        </span>
                      </SidebarItem>
                    );
                  })}
                </div>
              </section>
              <section className="space-y-2">
                <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Agents
                </div>
                <div className="flex flex-col gap-0.5">
                  {AGENT_LINKS.map((agent) => {
                    const href = `/projects/${project.id}/agents/${agent.key}`;
                    const Icon = agent.icon;
                    return (
                      <SidebarItem
                        key={agent.key}
                        href={href}
                        onClick={() => {
                          if (isMobile) setOpen(false);
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <Icon size={14} />
                          {agent.label}
                        </span>
                      </SidebarItem>
                    );
                  })}
                </div>
              </section>
            </nav>
          ) : (
            <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-6">
              <section className="space-y-1">
                <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Dashboard
                </p>
                <div className="flex flex-col gap-0.5">
                  {GLOBAL_LINKS.map((item) => (
                    <SidebarItem
                      key={item.href}
                      href={item.href}
                      match="exact"
                      onClick={() => {
                        if (isMobile) setOpen(false);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <item.icon size={14} />
                        {item.label}
                      </span>
                    </SidebarItem>
                  ))}
                </div>
              </section>

              <section className="space-y-1">
                <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Projects
                </p>
                <div className="flex flex-col gap-0.5">
                  {projectList.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">No projects yet</p>
                  ) : (
                    projectList.slice(0, 6).map((item) => (
                      <SidebarItem
                        key={item.id}
                        href={`/projects/${item.id}/overview`}
                        match="startsWith"
                        onClick={() => {
                          if (isMobile) setOpen(false);
                        }}
                      >
                        {item.name || 'Untitled Project'}
                      </SidebarItem>
                    ))
                  )}
                  {/* No "see all" button: global nav entry already routes via Projects */}
                </div>
              </section>
            </nav>
          )}
        </div>

        {/* Footer + Dropdown */}
        <div className="relative border-t px-4 py-3">
          {userEmail ? (
            <div className="relative w-full" ref={dropdownRef}>
              <button
                onClick={() => setOpenDropdown(!openDropdown)}
                className="text-sm text-muted-foreground hover:text-foreground w-full text-left truncate"
              >
                {userEmail}
              </button>
              {openDropdown && (
                <div className="absolute bottom-12 left-0 w-52 rounded-md border bg-popover shadow-md z-50 py-1 text-sm">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setOpenDropdown(false);
                      handleNavigateToSettings();
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    <Settings2 size={14} />
                    Settings
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setOpenDropdown(false);
                      router.push("/governance/settings");
                      if (isMobile) setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    <Shield size={14} />
                    Review Settings
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      handleLogout();
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-destructive hover:bg-muted"
                  >
                    <LogOut size={14} />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not signed in</p>
          )}
        </div>
      </aside>
    </>
  );
}
