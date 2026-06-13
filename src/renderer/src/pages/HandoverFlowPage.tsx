import { useEffect, useState } from 'react'
import type { ItemUnitWithDetails, Project } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const CONDITIONS = ['Good', 'Damaged', 'Needs Repair', 'Lost']

const ACTION_RETURN = 'Return to stock'
const ACTION_RETAIN = 'Retain at site'
const ACTION_RETIRE = 'Retire / Dispose'
const ACTION_TRANSFER = 'Transfer to another project'
const ACTIONS = [ACTION_RETURN, ACTION_RETAIN, ACTION_RETIRE, ACTION_TRANSFER]

const UNASSIGNED = '__unassigned__'

interface UnitState {
  condition: string
  action: string
  destProjectId: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function HandoverFlowPage({
  projectSeed
}: {
  projectSeed?: { projectId: number; nonce: number } | null
} = {}): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [units, setUnits] = useState<ItemUnitWithDetails[]>([])
  const [unitStates, setUnitStates] = useState<Record<number, UnitState>>({})
  const [handoverDate, setHandoverDate] = useState(today())
  const [handedOverBy, setHandedOverBy] = useState('')
  const [receivedBy, setReceivedBy] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    window.api.projects.list().then(setProjects)
  }, [])

  useEffect(() => {
    if (projectSeed) setProjectId(String(projectSeed.projectId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSeed?.nonce])

  useEffect(() => {
    if (!projectId) {
      setUnits([])
      return
    }
    window.api.itemUnits.list({ projectId: Number(projectId) }).then((rows) => {
      setUnits(rows)
      setUnitStates((prev) => {
        const next: Record<number, UnitState> = {}
        for (const unit of rows) {
          next[unit.id] = prev[unit.id] ?? { condition: '', action: '', destProjectId: UNASSIGNED }
        }
        return next
      })
    })
  }, [projectId])

  function updateUnitState(unitId: number, field: keyof UnitState, value: string): void {
    setUnitStates((prev) => ({
      ...prev,
      [unitId]: { ...prev[unitId], [field]: value }
    }))
  }

  async function handleSubmit(): Promise<void> {
    if (!projectId) return
    const numericProjectId = Number(projectId)

    for (const unit of units) {
      const state = unitStates[unit.id]
      if (state?.action === ACTION_TRANSFER && state.destProjectId === UNASSIGNED) {
        setError(`Choose a destination project for ${unit.serialId ?? `unit #${unit.id}`}.`)
        return
      }
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await window.api.handovers.create({
        projectId: numericProjectId,
        handoverDate,
        handedOverBy: handedOverBy.trim() || null,
        receivedBy: receivedBy.trim() || null,
        notes: notes.trim() || null,
        signatureRef: null,
        items: units.map((unit) => {
          const state = unitStates[unit.id]
          const transferProjectId =
            state?.action === ACTION_TRANSFER && state.destProjectId !== UNASSIGNED
              ? Number(state.destProjectId)
              : null
          return {
            itemUnitId: unit.id,
            condition: state?.condition || null,
            action: state?.action || null,
            transferProjectId
          }
        })
      })

      // Apply per-unit side effects based on the chosen action.
      for (const unit of units) {
        const state = unitStates[unit.id]
        if (!state?.action) continue

        if (state.action === ACTION_RETURN) {
          await window.api.itemUnits.update(unit.id, {
            itemId: unit.itemId,
            serialId: unit.serialId,
            assignedProjectId: null,
            auditDate: unit.auditDate,
            remarks: unit.remarks,
            status: 'Available',
            photoEvidenceRef: unit.photoEvidenceRef
          })
        } else if (state.action === ACTION_RETIRE) {
          await window.api.itemUnits.update(unit.id, {
            itemId: unit.itemId,
            serialId: unit.serialId,
            assignedProjectId: null,
            auditDate: unit.auditDate,
            remarks: unit.remarks,
            status: 'Retired-Damaged',
            photoEvidenceRef: unit.photoEvidenceRef
          })
        } else if (state.action === ACTION_TRANSFER) {
          const destProjectId = Number(state.destProjectId)
          await window.api.itemUnits.update(unit.id, {
            itemId: unit.itemId,
            serialId: unit.serialId,
            assignedProjectId: destProjectId,
            auditDate: unit.auditDate,
            remarks: unit.remarks,
            status: unit.status,
            photoEvidenceRef: unit.photoEvidenceRef
          })
          await window.api.transfers.create({
            date: handoverDate,
            itemId: unit.itemId,
            serialId: unit.serialId,
            qty: 1,
            fromProjectId: numericProjectId,
            toProjectId: destProjectId,
            transferredBy: handedOverBy.trim() || null,
            authorizedBy: receivedBy.trim() || null,
            notes: `Handover transfer (${unit.itemName})`,
            status: 'Completed'
          })
        }
        // ACTION_RETAIN: unit stays assigned to this project — no change needed.
      }

      await window.api.projects.setStatus(numericProjectId, 'completed')

      setSuccess('Handover recorded and project marked as completed.')
      setHandedOverBy('')
      setReceivedBy('')
      setNotes('')
      setUnitStates({})
      setUnits([])
      setProjectId('')
      window.api.projects.list().then(setProjects)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-[#1D1D1F]">New handover</h2>
        <p className="mt-0.5 text-xs text-[#6E6E73]">
          Record a hand-over of all units currently assigned to a project — set the condition and
          follow-up action for each unit. Submitting marks the project as completed.
        </p>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {success && <p className="text-sm text-emerald-600">{success}</p>}

      <div className="grid grid-cols-2 gap-3 rounded-md border border-[#E5E5E5] bg-white p-4 lg:grid-cols-5">
        <div className="flex flex-col gap-1">
          <Label>Project</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {projects
                .filter((p) => p.status === 'active')
                .map((project) => (
                  <SelectItem key={project.id} value={String(project.id)}>
                    {project.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="handover-date">Date</Label>
          <Input
            id="handover-date"
            type="date"
            value={handoverDate}
            onChange={(e) => setHandoverDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="handed-over-by">Handed over by</Label>
          <Input
            id="handed-over-by"
            value={handedOverBy}
            onChange={(e) => setHandedOverBy(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="received-by">Received by</Label>
          <Input
            id="received-by"
            value={receivedBy}
            onChange={(e) => setReceivedBy(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="handover-notes">Notes</Label>
          <Input id="handover-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-[#E5E5E5]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[#F5F5F7]">
            <tr className="text-xs font-medium tracking-wide text-[#6E6E73] uppercase">
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Serial / ID</th>
              <th className="px-3 py-2 text-left">Condition</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Destination</th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit, idx) => (
              <tr
                key={unit.id}
                className={`border-t border-[#F0F0F0] ${idx % 2 === 0 ? 'bg-white' : 'bg-[#FAFAFA]'}`}
              >
                <td className="px-3 py-2 text-[#6E6E73]">
                  {unit.itemCategory} — <span className="text-[#1D1D1F]">{unit.itemName}</span>
                </td>
                <td className="px-3 py-2 font-medium text-[#1D1D1F]">{unit.serialId ?? '—'}</td>
                <td className="px-3 py-2">
                  <Select
                    value={unitStates[unit.id]?.condition ?? ''}
                    onValueChange={(v) => updateUnitState(unit.id, 'condition', v)}
                  >
                    <SelectTrigger className="h-7 w-40 text-[13px]">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITIONS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <Select
                    value={unitStates[unit.id]?.action ?? ''}
                    onValueChange={(v) => updateUnitState(unit.id, 'action', v)}
                  >
                    <SelectTrigger className="h-7 w-52 text-[13px]">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTIONS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2">
                  {unitStates[unit.id]?.action === ACTION_TRANSFER ? (
                    <Select
                      value={unitStates[unit.id]?.destProjectId ?? UNASSIGNED}
                      onValueChange={(v) => updateUnitState(unit.id, 'destProjectId', v)}
                    >
                      <SelectTrigger className="h-7 w-48 text-[13px]">
                        <SelectValue placeholder="Choose project…" />
                      </SelectTrigger>
                      <SelectContent>
                        {projects
                          .filter((p) => String(p.id) !== projectId)
                          .map((project) => (
                            <SelectItem key={project.id} value={String(project.id)}>
                              {project.name}
                              {project.status === 'completed' ? ' (completed)' : ''}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-[#D1D1D6]">—</span>
                  )}
                </td>
              </tr>
            ))}
            {projectId && units.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-[#6E6E73]">
                  No units currently assigned to this project.
                </td>
              </tr>
            )}
            {!projectId && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-[#6E6E73]">
                  Choose a project to list its assigned units.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={!projectId || units.length === 0 || saving}>
          Record handover &amp; complete project
        </Button>
      </div>
    </div>
  )
}
