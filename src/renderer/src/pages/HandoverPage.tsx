import { useState, useEffect } from 'react'
import { Transfer } from '@shared/ipc'

export function HandoverPage(): React.JSX.Element {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadTransfers()
  }, [])

  const loadTransfers = async () => {
    try {
      setLoading(true)
      const transferList = await window.api.transfers.list()
      // Filter for handover-related transfers (you can customize this filter)
      const handoverTransfers = transferList.filter(t => t.status === 'Recorded' || t.status === 'Completed')
      setTransfers(handoverTransfers)
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

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Handover Records</h1>
      
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Serial</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Qty</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">From</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">To</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Transferred By</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {transfers.map((transfer) => (
              <tr key={transfer.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{transfer.date}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{transfer.itemId}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{transfer.serialId || '-'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{transfer.qty}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {transfer.fromProjectId || 'Available'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {transfer.toProjectId || 'Unassigned'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{transfer.transferredBy || '-'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{transfer.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}