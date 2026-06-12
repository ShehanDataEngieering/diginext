import { useEffect, useState } from 'react'
import type { ItemUnitWithDetails, Project } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">New handover</h2>
        <p className="text-muted-foreground text-sm">
          Record a hand-over of all units currently assigned to a project — set the condition and
          follow-up action for each unit. Submitting marks the project as completed.
        </p>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {success && <p className="text-sm text-emerald-600">{success}</p>}

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Project</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-56">
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="handover-date">Date</Label>
          <Input
            id="handover-date"
            type="date"
            value={handoverDate}
            onChange={(e) => setHandoverDate(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="handed-over-by">Handed over by</Label>
          <Input
            id="handed-over-by"
            value={handedOverBy}
            onChange={(e) => setHandedOverBy(e.target.value)}
            className="w-48"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="received-by">Received by</Label>
          <Input
            id="received-by"
            value={receivedBy}
            onChange={(e) => setReceivedBy(e.target.value)}
            className="w-48"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="handover-notes">Notes</Label>
          <Input id="handover-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Serial / ID</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Destination</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.map((unit) => (
              <TableRow key={unit.id}>
                <TableCell>
                  {unit.itemCategory} — {unit.itemName}
                </TableCell>
                <TableCell className="font-medium">{unit.serialId ?? '—'}</TableCell>
                <TableCell>
                  <Select
                    value={unitStates[unit.id]?.condition ?? ''}
                    onValueChange={(v) => updateUnitState(unit.id, 'condition', v)}
                  >
                    <SelectTrigger className="w-40">
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
                </TableCell>
                <TableCell>
                  <Select
                    value={unitStates[unit.id]?.action ?? ''}
                    onValueChange={(v) => updateUnitState(unit.id, 'action', v)}
                  >
                    <SelectTrigger className="w-52">
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
                </TableCell>
                <TableCell>
                  {unitStates[unit.id]?.action === ACTION_TRANSFER ? (
                    <Select
                      value={unitStates[unit.id]?.destProjectId ?? UNASSIGNED}
                      onValueChange={(v) => updateUnitState(unit.id, 'destProjectId', v)}
                    >
                      <SelectTrigger className="w-48">
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
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {projectId && units.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  No units currently assigned to this project.
                </TableCell>
              </TableRow>
            )}
            {!projectId && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  Choose a project to list its assigned units.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={!projectId || units.length === 0 || saving}>
          Record handover &amp; complete project
        </Button>
      </div>
    </div>
  )
}
