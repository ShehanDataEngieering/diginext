import { useEffect, useMemo, useState } from 'react'
import { Camera, Search } from 'lucide-react'
import type { ItemUnitWithDetails } from '@shared/ipc'
import { PhotoThumbnail } from '@/components/PhotoThumbnail'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const ALL_PROJECTS = '__all__'

export function PhotoLogPage(): React.JSX.Element {
  const [units, setUnits] = useState<ItemUnitWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS)

  async function load(): Promise<void> {
    try {
      setLoading(true)
      const allUnits = await window.api.itemUnits.list()
      setUnits(allUnits)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const unitsWithPhotos = useMemo(
    () => units.filter((u) => u.photoEvidenceRef !== null && u.photoEvidenceRef !== ''),
    [units]
  )

  const projectNames = useMemo(() => {
    const names = new Map<number, string>()
    for (const u of units) {
      if (u.assignedProjectId !== null && u.projectName) {
        names.set(u.assignedProjectId, u.projectName)
      }
    }
    return Array.from(names.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [units])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return unitsWithPhotos.filter((u) => {
      if (projectFilter !== ALL_PROJECTS && u.assignedProjectId !== Number(projectFilter)) return false
      if (needle) {
        const haystack = `${u.serialId ?? ''} ${u.itemName} ${u.itemCategory}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [unitsWithPhotos, search, projectFilter])

  if (loading) {
    return <div className="p-6 text-[13px] text-gray-500">Loading photos…</div>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-3.5 pt-3.5 pb-2.5">
        <h2 className="text-[16px] font-semibold text-gray-900">Photo Log</h2>
        <p className="mt-1 text-[12px] text-gray-500">
          All item units with attached photo evidence — {unitsWithPhotos.length} photo{unitsWithPhotos.length === 1 ? '' : 's'} total.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3.5 py-2">
        <div className="relative max-w-[220px]">
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search serial or item…"
            className="h-auto rounded-md border-gray-200 py-1 pl-7 text-[12px] focus-visible:ring-2 focus-visible:ring-blue-400"
          />
        </div>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-auto w-48 rounded-md border-gray-200 py-1 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
            {projectNames.map(([id, name]) => (
              <SelectItem key={id} value={String(id)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="px-3.5 pt-2 text-[12px] text-red-500">{error}</p>}

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Camera size={32} className="mb-3 text-gray-300" />
            <p className="text-[13px] text-gray-400">
              {unitsWithPhotos.length === 0
                ? 'No photos attached to any units yet.'
                : 'No photos match the current filters.'}
            </p>
          </div>
        ) : (
          <table className="w-full table-fixed border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-[#EFEFEF]">
              <tr className="text-[10px] font-semibold tracking-wider text-gray-400 uppercase">
                <th className="w-[64px] px-3 py-2 text-left">Photo</th>
                <th className="px-3 py-2 text-left">Serial / Unique ID</th>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Project</th>
                <th className="w-[110px] px-3 py-2 text-left">Audit Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((unit, idx) => (
                <tr
                  key={unit.id}
                  className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}
                >
                  <td className="px-3 py-2">
                    <PhotoThumbnail
                      reference={unit.photoEvidenceRef}
                      label={unit.serialId ?? `${unit.itemName} (unit #${unit.id})`}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-800">
                    {unit.serialId ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-900">{unit.itemName}</td>
                  <td className="px-3 py-2 text-gray-500">{unit.itemCategory}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {unit.projectName ?? <span className="text-gray-400">Available</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    {unit.auditDate ?? <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
