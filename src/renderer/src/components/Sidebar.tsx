import {
  ArrowLeftRight,
  Boxes,
  Camera,
  ClipboardCheck,
  Gauge,
  FolderKanban,
  Package,
  Settings,
  LogOut
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Project } from '@shared/ipc'
import { supabase } from '@/auth/supabaseClient'

export type ViewTab =
  | 'dashboard'
  | 'items'
  | 'projects'
  | 'item-units'
  | 'photo-log'
  | 'settings'
  | 'transfers'
  | 'handovers'
  | 'handover-flow'

const VIEW_ITEMS: { tab: ViewTab; label: string; icon: typeof Gauge }[] = [
  { tab: 'dashboard', label: 'Dashboard', icon: Gauge },
  { tab: 'items', label: 'Items', icon: Package },
  { tab: 'projects', label: 'Projects', icon: FolderKanban },
  { tab: 'item-units', label: 'Item units', icon: Boxes },
  { tab: 'photo-log', label: 'Photo Log', icon: Camera },
  { tab: 'transfers', label: 'Transfers', icon: ArrowLeftRight },
  { tab: 'handovers', label: 'Handovers', icon: ClipboardCheck },
  { tab: 'settings', label: 'Settings', icon: Settings }
]

interface SidebarProps {
  activeTab: ViewTab
  onSelectView: (tab: ViewTab) => void
  itemCount: number
  projects: Project[]
  categories: string[]
  onSelectProject: (projectId: number) => void
  onSelectCategory: (category: string) => void
}

// Each entry in the "Categories" section gets a small colored dot, matching
// the table's category-group rows. Anything beyond these two known buckets
// falls through to a neutral gray dot rather than crashing on new categories.
const CATEGORY_DOT_COLOR: Record<string, string> = {
  'Office Use Items': 'bg-blue-500',
  'Safety Related Items': 'bg-orange-400'
}

function categoryDotClass(category: string): string {
  return CATEGORY_DOT_COLOR[category] ?? 'bg-gray-400'
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-1 px-3 pt-4 text-xs font-medium tracking-wider text-[#AEAEB2] uppercase first:pt-2">
      {children}
    </div>
  )
}

function NavRow({
  active,
  onClick,
  icon,
  label,
  badge,
  dot
}: {
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
  label: string
  badge?: number | string
  dot?: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'mx-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors duration-150',
        active
          ? 'bg-[#DCE8F8] font-medium text-[#0066CC]'
          : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'
      )}
    >
      {dot}
      {icon}
      <span className="truncate">{label}</span>
      {badge !== undefined && (
        <span
          className={cn(
            'ml-auto shrink-0 rounded-full px-1.5 text-xs tabular-nums',
            active ? 'bg-[#0066CC]/10 text-[#0066CC]' : 'bg-[#E5E5E5] text-[#6E6E73]'
          )}
        >
          {badge}
        </span>
      )}
    </button>
  )
}

/**
 * Finder-style left sidebar: fixed sections of navigation. "Views" switches
 * the main tab; "Projects" / "Categories" are live shortcuts into a
 * pre-filtered Item Units / Dashboard view (see App.tsx's seed-filter props)
 * — kept data-driven so the list never goes stale as projects/items change.
 */
export function Sidebar({
  activeTab,
  onSelectView,
  itemCount,
  projects,
  categories,
  onSelectProject,
  onSelectCategory
}: SidebarProps): React.JSX.Element {
  const activeProjects = projects.filter((p) => p.status === 'active')

  return (
    <nav className="flex h-full w-[220px] shrink-0 flex-col overflow-y-auto border-r border-[#E5E5E5] bg-[#F5F5F7] py-2">
      <SectionLabel>Views</SectionLabel>
      {VIEW_ITEMS.map(({ tab, label, icon: Icon }) => (
        <NavRow
          key={tab}
          active={activeTab === tab}
          onClick={() => onSelectView(tab)}
          icon={<Icon size={16} strokeWidth={1.5} className="shrink-0 text-current" />}
          label={label}
          badge={
            tab === 'dashboard' ? itemCount : tab === 'projects' ? projects.length : undefined
          }
        />
      ))}

      {activeProjects.length > 0 && (
        <>
          <SectionLabel>Projects</SectionLabel>
          {activeProjects.map((project) => (
            <NavRow
              key={project.id}
              active={false}
              onClick={() => onSelectProject(project.id)}
              label={project.name}
            />
          ))}
        </>
      )}

      {categories.length > 0 && (
        <>
          <SectionLabel>Categories</SectionLabel>
          {categories.map((category) => (
            <NavRow
              key={category}
              active={false}
              onClick={() => onSelectCategory(category)}
              dot={<span className={cn('size-1.5 shrink-0 rounded-full', categoryDotClass(category))} />}
              label={category}
            />
          ))}
        </>
      )}

      <div className="mt-auto border-t border-[#E5E5E5] pt-2 pb-1">
        <button
          onClick={() => supabase.auth.signOut()}
          className="mx-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-[#6E6E73] transition-colors duration-150 hover:bg-[#E8E8ED]"
        >
          <LogOut size={16} strokeWidth={1.5} />
          <span>Sign Out</span>
        </button>
      </div>
    </nav>
  )
}
