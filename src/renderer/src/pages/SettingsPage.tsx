import { useState, useEffect } from 'react'
import { BackupInfo } from '@shared/ipc'

export function SettingsPage(): React.JSX.Element {
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadBackups()
  }, [])

  const loadBackups = async () => {
    try {
      setLoading(true)
      const backupList = await window.api.db.listBackups()
      setBackups(backupList)
      setError(null)
    } catch (err) {
      setError('Failed to load backups')
      console.error('Error loading backups:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleBackupNow = async () => {
    try {
      await window.api.db.backupNow()
      await loadBackups()
    } catch (err) {
      setError('Failed to create backup')
      console.error('Error creating backup:', err)
    }
  }

  const handleRestore = async (backupPath: string) => {
    if (window.confirm('Are you sure you want to restore from this backup? This will overwrite your current database.')) {
      try {
        await window.api.db.restoreBackup(backupPath)
        alert('Database restored successfully. Please restart the application.')
      } catch (err) {
        setError('Failed to restore backup')
        console.error('Error restoring backup:', err)
      }
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Database Backup</h2>
        
        <div className="flex gap-3 mb-4">
          <button
            onClick={handleBackupNow}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
            disabled={loading}
          >
            {loading ? 'Backing up...' : 'Backup Now'}
          </button>
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">
            {error}
          </div>
        )}
        
        <div>
          <h3 className="font-medium mb-2">Backups</h3>
          {loading ? (
            <p>Loading backups...</p>
          ) : backups.length === 0 ? (
            <p>No backups found</p>
          ) : (
            <div className="space-y-2">
              {backups.map((backup) => (
                <div key={backup.name} className="flex items-center justify-between p-3 border rounded">
                  <div>
                    <div className="font-medium">{backup.name}</div>
                    <div className="text-sm text-gray-500">{new Date(backup.createdAt).toLocaleString()}</div>
                  </div>
                  <button
                    onClick={() => handleRestore(backup.path)}
                    className="px-3 py-1 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors text-sm"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}