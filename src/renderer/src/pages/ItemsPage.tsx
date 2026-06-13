import { useEffect, useMemo, useState } from 'react'
import { Package, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Item, ItemInput } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Known categories from the original Master_Inventory workbook — offered as
// quick-pick suggestions, but the field stays free text since new categories
// will inevitably come up (per plan: "free-text-with-suggestions").
const KNOWN_CATEGORIES = [
  'Termination Tools',
  'Safety Related Items',
  'Site Tools',
  'Office Use Items',
  'Welfare'
]

const emptyForm: ItemInput = { category: '', name: '', initialStock: 0 }

export function ItemsPage(): React.JSX.Element {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialogItem, setDialogItem] = useState<Item | 'new' | null>(null)
  const [form, setForm] = useState<ItemInput>(emptyForm)
  const [saving, setSaving] = useState(false)

  async function reload(): Promise<void> {
    try {
      setItems(await window.api.items.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const categorySuggestions = useMemo(() => {
    const fromData = (items ?? []).map((item) => item.category)
    return Array.from(new Set([...KNOWN_CATEGORIES, ...fromData])).sort()
  }, [items])

  function openCreate(): void {
    setForm(emptyForm)
    setDialogItem('new')
  }

  function openEdit(item: Item): void {
    setForm({ category: item.category, name: item.name, initialStock: item.initialStock })
    setDialogItem(item)
  }

  async function handleSave(): Promise<void> {
    if (!form.category.trim() || !form.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      if (dialogItem === 'new') {
        await window.api.items.create(form)
      } else if (dialogItem) {
        await window.api.items.update(dialogItem.id, form)
      }
      setDialogItem(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(item: Item): Promise<void> {
    if (!confirm(`Delete "${item.name}"? This only works if it has no recorded units.`)) return
    setError(null)
    try {
      await window.api.items.delete(item.id)
      await reload()
    } catch (err) {
      // Surfaces the friendly FK-violation message translated in dataHandlers.ts
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#1D1D1F]">Items catalog</h2>
          <p className="mt-0.5 text-xs text-[#6E6E73]">
            Item types — categories, names, and expected stock levels. Individually tracked
            units live under Item Units.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} strokeWidth={1.5} /> Add item
        </Button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="overflow-hidden rounded-md border border-[#E5E5E5]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[#F5F5F7]">
            <tr className="text-xs font-medium tracking-wide text-[#6E6E73] uppercase">
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-right">Initial stock</th>
              <th className="w-24 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items?.map((item, idx) => (
              <tr
                key={item.id}
                className={`group h-9 border-t border-[#F0F0F0] transition-colors duration-150 hover:bg-[#F0F6FF] ${
                  idx % 2 === 0 ? 'bg-white' : 'bg-[#FAFAFA]'
                }`}
              >
                <td className="px-3 py-2 text-[#6E6E73]">{item.category}</td>
                <td className="px-3 py-2 font-medium text-[#1D1D1F]">{item.name}</td>
                <td className="px-3 py-2 text-right text-[#1D1D1F] tabular-nums">{item.initialStock}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(item)} title="Edit">
                      <Pencil size={14} strokeWidth={1.5} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-[#6E6E73] hover:text-red-600"
                      onClick={() => handleDelete(item)}
                      title="Delete"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {items?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-12 text-center">
                  <Package size={40} strokeWidth={1.5} className="mx-auto mb-2 text-[#AEAEB2]" />
                  <p className="text-sm font-medium text-[#1D1D1F]">No items yet</p>
                  <p className="mt-0.5 mb-3 text-xs text-[#6E6E73]">
                    Add your first item type to start tracking inventory.
                  </p>
                  <Button size="sm" onClick={openCreate}>
                    <Plus size={14} strokeWidth={1.5} /> Add item
                  </Button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={dialogItem !== null} onOpenChange={(open) => !open && setDialogItem(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{dialogItem === 'new' ? 'Add item' : 'Edit item'}</SheetTitle>
            <SheetDescription>
              Item type details. Individual serialized units are managed separately.
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="item-category">Category</Label>
              <Input
                id="item-category"
                list="item-category-suggestions"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="e.g. Site Tools"
              />
              <datalist id="item-category-suggestions">
                {categorySuggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="item-name">Name</Label>
                <Input
                  id="item-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Body Harness"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="item-stock">Initial stock</Label>
                <Input
                  id="item-stock"
                  type="number"
                  min={0}
                  value={form.initialStock}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, initialStock: Number(e.target.value) || 0 }))
                  }
                />
              </div>
            </div>
          </SheetBody>

          <SheetFooter>
            <Button variant="outline" onClick={() => setDialogItem(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.category.trim() || !form.name.trim()}>
              {dialogItem === 'new' ? 'Create' : 'Save changes'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
