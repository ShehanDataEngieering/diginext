import { useState, useEffect } from 'react'
import { DatabaseBackup, History, RotateCcw } from 'lucide-react'
import { BackupInfo } from '@shared/ipc'
import { Button } from '@/components/ui/button'

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
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-[#1D1D1F]">Settings</h2>
        <p className="mt-0.5 text-xs text-[#6E6E73]">Database backups and maintenance.</p>
      </div>

      <div className="rounded-md border border-[#E5E5E5] bg-white">
        <div className="flex items-center justify-between border-b border-[#E5E5E5] px-4 py-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#1D1D1F]">
              <DatabaseBackup size={16} strokeWidth={1.5} className="text-[#6E6E73]" />
              Database Backup
            </h3>
            <p className="mt-0.5 text-xs text-[#6E6E73]">
              Backups are created automatically on launch; create one manually any time.
            </p>
          </div>
          <Button onClick={handleBackupNow} disabled={loading}>
            {loading ? 'Backing up…' : 'Backup Now'}
          </Button>
        </div>

        {error && <div className="border-b border-[#E5E5E5] px-4 py-2 text-sm text-red-600">{error}</div>}

        <div className="px-4 py-3">
          <h4 className="mb-2 text-xs font-medium tracking-wide text-[#6E6E73] uppercase">Backups</h4>
          {loading ? (
            <p className="text-sm text-[#6E6E73]">Loading backups…</p>
          ) : backups.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <History size={40} strokeWidth={1.5} className="mb-2 text-[#AEAEB2]" />
              <p className="text-sm font-medium text-[#1D1D1F]">No backups found</p>
              <p className="mt-0.5 text-xs text-[#6E6E73]">Use "Backup Now" to create the first one.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {backups.map((backup) => (
                <div
                  key={backup.name}
                  className="group flex items-center justify-between rounded-md border border-[#E5E5E5] px-3 py-2 transition-colors duration-150 hover:bg-[#F5F5F7]"
                >
                  <div>
                    <div className="text-sm font-medium text-[#1D1D1F]">{backup.name}</div>
                    <div className="text-xs text-[#6E6E73]">
                      {new Date(backup.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                    onClick={() => handleRestore(backup.path)}
                  >
                    <RotateCcw size={14} strokeWidth={1.5} /> Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}