import { useState, useEffect, useMemo } from 'react'
import { ArrowLeftRight, ArrowRight, ChevronDown, ChevronRight } from 'lucide-react'
import { Transfer, Item, Project } from '@shared/ipc'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const ALL_PROJECTS = '__all__'

export function TransferLogPage(): React.JSX.Element {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS)
  const [expandedId, setExpandedId] = useState<number | null>(null)

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

  const filtered = useMemo(() => {
    if (projectFilter === ALL_PROJECTS) return transfers
    const id = Number(projectFilter)
    return transfers.filter((t) => t.fromProjectId === id || t.toProjectId === id)
  }, [transfers, projectFilter])

  if (loading) {
    return <div className="p-4 text-sm text-[#6E6E73]">Loading transfers…</div>
  }

  if (error) {
    return <div className="p-4 text-sm text-red-600">{error}</div>
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#1D1D1F]">Transfer Log</h2>
          <p className="mt-0.5 text-xs text-[#6E6E73]">
            Every unit movement between projects, newest first — recorded automatically on transfer.
          </p>
        </div>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-7 w-52 text-[13px]">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
            {projects.filter((p) => p.status === 'active').map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-md border border-[#E5E5E5]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[#F5F5F7]">
            <tr className="text-xs font-medium tracking-wide text-[#6E6E73] uppercase">
              <th className="w-6 px-1 py-2" />
              <th className="w-28 px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Item · Serial</th>
              <th className="px-3 py-2 text-left">Movement</th>
              <th className="w-24 px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((transfer, idx) => {
              const expanded = expandedId === transfer.id
              return (
                <>
                  <tr
                    key={transfer.id}
                    onClick={() => setExpandedId(expanded ? null : transfer.id)}
                    className={`h-8 cursor-pointer border-t border-[#F0F0F0] transition-colors duration-150 hover:bg-[#F0F6FF] ${
                      expanded ? 'bg-[#F0F6FF]' : idx % 2 === 0 ? 'bg-white' : 'bg-[#FAFAFA]'
                    }`}
                  >
                    <td className="px-1 py-1.5 text-center text-[#AEAEB2]">
                      {expanded
                        ? <ChevronDown size={12} strokeWidth={1.5} />
                        : <ChevronRight size={12} strokeWidth={1.5} />}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-xs text-[#6E6E73] tabular-nums">
                      {transfer.date}
                    </td>
                    <td className="px-3 py-1.5 text-[#1D1D1F]">
                      <span className="text-xs">{itemName(transfer.itemId)}</span>
                      {transfer.serialId && (
                        <span className="ml-2 font-medium text-[#1D1D1F] text-xs">
                          · {transfer.serialId}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1 text-xs">
                        <span className="text-[#6E6E73]">{projectName(transfer.fromProjectId)}</span>
                        <ArrowRight size={11} strokeWidth={1.5} className="shrink-0 text-[#AEAEB2]" />
                        <span className="font-medium text-[#1D1D1F]">{projectName(transfer.toProjectId)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="inline-block rounded-sm bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700">
                        {transfer.status}
                      </span>
                    </td>
                  </tr>
                  {expanded && (
                    <tr
                      key={`${transfer.id}-detail`}
                      className="border-t border-[#E5E5E5] bg-[#F8F8FF]"
                    >
                      <td colSpan={5} className="px-6 py-2.5">
                        <div className="flex flex-wrap gap-6 text-xs text-[#6E6E73]">
                          <span><span className="font-medium text-[#1D1D1F]">Qty:</span> {transfer.qty}</span>
                          {transfer.transferredBy && (
                            <span><span className="font-medium text-[#1D1D1F]">Transferred by:</span> {transfer.transferredBy}</span>
                          )}
                          {transfer.authorizedBy && (
                            <span><span className="font-medium text-[#1D1D1F]">Authorized by:</span> {transfer.authorizedBy}</span>
                          )}
                          {transfer.notes && (
                            <span><span className="font-medium text-[#1D1D1F]">Notes:</span> {transfer.notes}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-12 text-center">
                  <ArrowLeftRight size={40} strokeWidth={1.5} className="mx-auto mb-2 text-[#AEAEB2]" />
                  <p className="text-sm font-medium text-[#1D1D1F]">No transfers recorded yet</p>
                  <p className="mt-0.5 text-xs text-[#6E6E73]">
                    {projectFilter !== ALL_PROJECTS
                      ? 'No transfers for this project.'
                      : 'Transfers appear here automatically when units move between projects.'}
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
