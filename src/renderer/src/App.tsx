import { AuthGate } from './auth/AuthGate'

function App() {
  return (
    <AuthGate>
      <div className="app-shell">
        <header className="app-header">
          <h1>Inventory Manager</h1>
        </header>
        <main className="app-main">
          <p>Signed in. CRUD and Excel sync land in upcoming milestones.</p>
        </main>
      </div>
    </AuthGate>
  )
}

export default App
