import { useState, useEffect } from 'react'
import { ArrowLeftRight, ArrowRight } from 'lucide-react'
import { Transfer, Item, Project } from '@shared/ipc'

export function TransferLogPage(): React.JSX.Element {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadTransfers()
  }, [])

  const loadTransfers = async () => {
    try {
      setLoading(true)
      const [transferList, itemList, projectList] = await Promise.all([
        window.api.transfers.list(),
        window.api.items.list(),
        window.api.projects.list()
      ])
      setTransfers(transferList)
      setItems(itemList)
      setProjects(projectList)
      setError(null)
    } catch (err) {
      setError('Failed to load transfers')
      console.error('Error loading transfers:', err)
    } finally {
      setLoading(false)
    }
  }

  const itemName = (itemId: number): string => {
    const item = items.find((i) => i.id === itemId)
    return item ? `${item.category} — ${item.name}` : `Item #${itemId}`
  }

  const projectName = (projectId: number | null): string => {
    if (projectId === null) return 'Available'
    return projects.find((p) => p.id === projectId)?.name ?? `Project #${projectId}`
  }

  if (loading) {
    return <div className="p-4 text-sm text-[#6E6E73]">Loading transfers…</div>
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-sm text-red-600">{error}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-[#1D1D1F]">Transfer Log</h2>
        <p className="mt-0.5 text-xs text-[#6E6E73]">
          Every unit movement between projects, newest first — recorded automatically on transfer.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border border-[#E5E5E5]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[#F5F5F7]">
            <tr className="text-xs font-medium tracking-wide text-[#6E6E73] uppercase">
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Serial</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-left">From</th>
              <th className="px-3 py-2 text-left">To</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((transfer, idx) => (
              <tr
                key={transfer.id}
                className={`h-9 border-t border-[#F0F0F0] transition-colors duration-150 hover:bg-[#F0F6FF] ${
                  idx % 2 === 0 ? 'bg-white' : 'bg-[#FAFAFA]'
                }`}
              >
                <td className="px-3 py-2 whitespace-nowrap text-[#6E6E73] tabular-nums">{transfer.date}</td>
                <td className="px-3 py-2 text-[#1D1D1F]">{itemName(transfer.itemId)}</td>
                <td className="px-3 py-2 font-medium whitespace-nowrap text-[#1D1D1F]">
                  {transfer.serialId || <span className="text-[#D1D1D6]">—</span>}
                </td>
                <td className="px-3 py-2 text-right text-[#6E6E73] tabular-nums">{transfer.qty}</td>
                <td className="px-3 py-2 text-[#6E6E73]">{projectName(transfer.fromProjectId)}</td>
                <td className="px-3 py-2 text-[#1D1D1F]">
                  <span className="inline-flex items-center gap-1">
                    <ArrowRight size={12} strokeWidth={1.5} className="text-[#AEAEB2]" />
                    {projectName(transfer.toProjectId)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="inline-block rounded-sm bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700">
                    {transfer.status}
                  </span>
                </td>
              </tr>
            ))}
            {transfers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center">
                  <ArrowLeftRight size={40} strokeWidth={1.5} className="mx-auto mb-2 text-[#AEAEB2]" />
                  <p className="text-sm font-medium text-[#1D1D1F]">No transfers recorded yet</p>
                  <p className="mt-0.5 text-xs text-[#6E6E73]">
                    Transfers appear here automatically when units move between projects.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}