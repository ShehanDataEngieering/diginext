import { useEffect, useMemo, useState } from 'react'
import type { Item, Project } from '@shared/ipc'
import { AuthGate } from './auth/AuthGate'
import { Sidebar, type ViewTab } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { DashboardPage } from './pages/DashboardPage'
import { ItemsPage } from './pages/ItemsPage'
import { ItemUnitsPage } from './pages/ItemUnitsPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { SettingsPage } from './pages/SettingsPage'
import { TransferLogPage } from './pages/TransferLogPage'
import { HandoverPage } from './pages/HandoverPage'
import { HandoverFlowPage } from './pages/HandoverFlowPage'
import { PhotoLogPage } from './pages/PhotoLogPage'

function App() {
  const [activeTab, setActiveTab] = useState<ViewTab>('dashboard')

  // Lightweight summary data the shell (sidebar badges, status bar) needs —
  // independent from each page's own data fetching so the shell doesn't have
  // to reach into page-local state. Re-fetched on tab changes, which covers
  // the common "I edited something, then switched views" case without wiring
  // a global cache/event-bus for what's fundamentally cosmetic chrome.
  const [shellItems, setShellItems] = useState<Item[]>([])
  const [shellProjects, setShellProjects] = useState<Project[]>([])
  const [shellUnitCount, setShellUnitCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([window.api.items.list(), window.api.projects.list(), window.api.itemUnits.list()]).then(
      ([items, projects, units]) => {
        if (!cancelled) {
          setShellItems(items)
          setShellProjects(projects)
          setShellUnitCount(units.length)
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [activeTab])

  const categories = useMemo(
    () => Array.from(new Set(shellItems.map((i) => i.category))).sort(),
    [shellItems]
  )

  // Counter-based "signals" rather than booleans: lets the same action (e.g.
  // clicking "Add item" twice, or the same sidebar project twice) re-trigger
  // the target page's effect even though the value "didn't change".
  const [addItemSignal, setAddItemSignal] = useState(0)
  const [categorySeed, setCategorySeed] = useState<{ category: string; nonce: number } | null>(null)
  const [projectSeed, setProjectSeed] = useState<{ projectId: number; nonce: number } | null>(null)

  function handleAddItem(): void {
    setActiveTab('items')
    setAddItemSignal((n) => n + 1)
  }

  function handleSelectProject(projectId: number): void {
    setActiveTab('item-units')
    setProjectSeed((prev) => ({ projectId, nonce: (prev?.nonce ?? 0) + 1 }))
  }

  const [handoverProjectSeed, setHandoverProjectSeed] = useState<{
    projectId: number
    nonce: number
  } | null>(null)

  function handleStartHandover(projectId: number): void {
    setActiveTab('handover-flow')
    setHandoverProjectSeed((prev) => ({ projectId, nonce: (prev?.nonce ?? 0) + 1 }))
  }

  function handleSelectCategory(category: string): void {
    setActiveTab('dashboard')
    setCategorySeed((prev) => ({ category, nonce: (prev?.nonce ?? 0) + 1 }))
  }

  return (
    <AuthGate>
      <div
        className="flex h-screen w-screen flex-col overflow-hidden"
        style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" }}
      >
        <TitleBar onAddItem={handleAddItem} />

        <div className="flex min-h-0 flex-1">
          <Sidebar
            activeTab={activeTab}
            onSelectView={setActiveTab}
            itemCount={shellItems.length}
            projects={shellProjects}
            categories={categories}
            onSelectProject={handleSelectProject}
            onSelectCategory={handleSelectCategory}
          />

          <main className="min-w-0 flex-1 overflow-hidden bg-white">
            {activeTab === 'dashboard' && <DashboardPage categorySeed={categorySeed} />}
            {activeTab === 'items' && (
              <div className="h-full overflow-y-auto p-3.5">
                <ItemsPage openCreateSignal={addItemSignal} />
              </div>
            )}
            {activeTab === 'projects' && (
              <div className="h-full overflow-y-auto p-3.5">
                <ProjectsPage onStartHandover={handleStartHandover} />
              </div>
            )}
            {activeTab === 'item-units' && (
              <div className="h-full overflow-y-auto p-3.5">
                <ItemUnitsPage projectSeed={projectSeed} />
              </div>
            )}
            {activeTab === 'photo-log' && (
              <div className="h-full overflow-y-auto p-3.5">
                <PhotoLogPage />
              </div>
            )}
            {activeTab === 'transfers' && (
              <div className="h-full overflow-y-auto p-3.5">
                <TransferLogPage />
              </div>
            )}
            {activeTab === 'handovers' && (
              <div className="h-full overflow-y-auto p-3.5">
                <HandoverPage />
              </div>
            )}
            {activeTab === 'handover-flow' && (
              <div className="h-full overflow-y-auto p-3.5">
                <HandoverFlowPage projectSeed={handoverProjectSeed} />
              </div>
            )}
            {activeTab === 'settings' && (
              <div className="h-full overflow-y-auto p-3.5">
                <SettingsPage />
              </div>
            )}
          </main>
        </div>

        <div className="flex h-[26px] shrink-0 items-center gap-2.5 border-t border-gray-200 bg-[#F5F5F5] px-3.5 text-[11px] text-gray-400">
          {activeTab === 'dashboard' && <span>{shellItems.length} items · Updated just now</span>}
          {activeTab === 'items' && <span>{shellItems.length} items · Updated just now</span>}
          {activeTab === 'projects' && <span>{shellProjects.length} projects · Updated just now</span>}
          {activeTab === 'item-units' && <span>{shellUnitCount} units · Updated just now</span>}
        </div>
      </div>
    </AuthGate>
  )
}

export default App
