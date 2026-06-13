import { useState, useEffect } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { Handover } from '@shared/ipc'

export function HandoverPage(): React.JSX.Element {
  const [handovers, setHandovers] = useState<Handover[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadHandovers()
  }, [])

  const loadHandovers = async () => {
    try {
      setLoading(true)
      const handoverList = await window.api.handovers.list()
      setHandovers(handoverList)
      setError(null)
    } catch (err) {
      setError('Failed to load handovers')
      console.error('Error loading handovers:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="p-4 text-sm text-[#6E6E73]">Loading handovers…</div>
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-sm text-red-600">{error}</div>
      </div>
    )
  }

  if (handovers.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#1D1D1F]">Handover Records</h2>
          <p className="mt-0.5 text-xs text-[#6E6E73]">
            Completed project hand-overs with per-unit condition and destination.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-md border border-[#E5E5E5] py-16 text-center">
          <ClipboardCheck size={40} strokeWidth={1.5} className="mb-2 text-[#AEAEB2]" />
          <p className="text-sm font-medium text-[#1D1D1F]">No handovers recorded yet</p>
          <p className="mt-0.5 text-xs text-[#6E6E73]">
            Start a handover from a project's row actions on the Projects page.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-[#1D1D1F]">Handover Records</h2>
        <p className="mt-0.5 text-xs text-[#6E6E73]">
          Completed project hand-overs with per-unit condition and destination.
        </p>
      </div>

      {handovers.map((handover) => (
        <div key={handover.id} className="overflow-hidden rounded-md border border-[#E5E5E5] bg-white">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#E5E5E5] bg-[#F5F5F7] px-3 py-2 text-xs">
            <span className="text-sm font-semibold text-[#1D1D1F]">{handover.projectName}</span>
            <span className="text-[#6E6E73]">Date: {handover.handoverDate}</span>
            <span className="text-[#6E6E73]">Handed over by: {handover.handedOverBy || '—'}</span>
            <span className="text-[#6E6E73]">Received by: {handover.receivedBy || '—'}</span>
            {handover.notes && <span className="text-[#6E6E73]">Notes: {handover.notes}</span>}
          </div>
          <table className="w-full border-collapse text-sm">
            <thead className="bg-[#F5F5F7]">
              <tr className="text-xs font-medium tracking-wide text-[#6E6E73] uppercase">
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Serial ID</th>
                <th className="px-3 py-2 text-left">Condition</th>
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">Destination</th>
              </tr>
            </thead>
            <tbody>
              {handover.items.map((item, idx) => (
                <tr
                  key={item.id}
                  className={`h-9 border-t border-[#F0F0F0] ${idx % 2 === 0 ? 'bg-white' : 'bg-[#FAFAFA]'}`}
                >
                  <td className="px-3 py-2 text-[#1D1D1F]">{item.itemName}</td>
                  <td className="px-3 py-2 text-[#6E6E73]">{item.itemCategory}</td>
                  <td className="px-3 py-2 font-medium text-[#1D1D1F]">
                    {item.serialId || <span className="text-[#D1D1D6]">—</span>}
                  </td>
                  <td className="px-3 py-2 text-[#6E6E73]">{item.condition || '—'}</td>
                  <td className="px-3 py-2 text-[#6E6E73]">{item.action || '—'}</td>
                  <td className="px-3 py-2 text-[#6E6E73]">{item.transferProjectName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
