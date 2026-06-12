import { useState, useEffect } from 'react'
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
    return <div className="p-6">Loading handovers...</div>
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="text-red-500">{error}</div>
      </div>
    )
  }

  if (handovers.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Handover Records</h1>
        <p className="text-sm text-muted-foreground">No handovers recorded yet.</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Handover Records</h1>

      {handovers.map((handover) => (
        <div key={handover.id} className="bg-white rounded-lg shadow overflow-hidden border">
          <div className="px-6 py-4 border-b bg-gray-50 flex flex-wrap items-center gap-4 text-sm">
            <span className="font-semibold text-base">{handover.projectName}</span>
            <span className="text-gray-500">Date: {handover.handoverDate}</span>
            <span className="text-gray-500">Handed over by: {handover.handedOverBy || '-'}</span>
            <span className="text-gray-500">Received by: {handover.receivedBy || '-'}</span>
            {handover.notes && <span className="text-gray-500">Notes: {handover.notes}</span>}
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Serial ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Condition</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Destination</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {handover.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.itemName}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.itemCategory}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.serialId || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.condition || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.action || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.transferProjectName || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
