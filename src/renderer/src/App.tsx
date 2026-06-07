import { AuthGate } from './auth/AuthGate'
import { DashboardPage } from './pages/DashboardPage'
import { ItemsPage } from './pages/ItemsPage'
import { ItemUnitsPage } from './pages/ItemUnitsPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'

function App() {
  return (
    <AuthGate>
      <div className="app-shell">
        <header className="app-header">
          <h1>Inventory Manager</h1>
        </header>
        <main className="app-main">
          <Tabs defaultValue="dashboard" className="gap-4">
            <TabsList>
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="items">Items</TabsTrigger>
              <TabsTrigger value="projects">Projects</TabsTrigger>
              <TabsTrigger value="item-units">Item units</TabsTrigger>
            </TabsList>
            <TabsContent value="dashboard">
              <DashboardPage />
            </TabsContent>
            <TabsContent value="items">
              <ItemsPage />
            </TabsContent>
            <TabsContent value="projects">
              <ProjectsPage />
            </TabsContent>
            <TabsContent value="item-units">
              <ItemUnitsPage />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </AuthGate>
  )
}

export default App
