import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getDatasetTypeInfo, listDatasetOptions, type DatasetSummary } from "@/lib/datasets"
import { useSessionStore } from "@/state/session"
import type { DatasetRef } from "@/lib/ilcd"

const NONE = "__none__"

interface DatasetRefFieldProps {
  label: string
  value: DatasetRef
  onChange: (value: DatasetRef) => void
  required?: boolean
}

export function DatasetRefField({ label, value, onChange, required }: DatasetRefFieldProps) {
  const [options, setOptions] = useState<DatasetSummary[]>([])
  const [error, setError] = useState<string>()
  const userId = useSessionStore((s) => s.session?.user.id)
  const typeInfo = getDatasetTypeInfo(value.type)

  useEffect(() => {
    let cancelled = false
    listDatasetOptions(value.type).then((rows) => {
      if (!cancelled) { setOptions(rows); setError(undefined) }
    }).catch(() => {
      if (!cancelled) { setOptions([]); setError("Couldn't load dataset choices.") }
    })
    return () => { cancelled = true }
  }, [value.type, userId])

  const unresolved =
    value.refObjectId && !options.some((o) => o.id === value.refObjectId)

  return (
    <div className="flex flex-col gap-2">
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <Select
        value={value.refObjectId ?? NONE}
        onValueChange={(id) => {
          if (id === NONE) {
            onChange({ ...value, refObjectId: null, shortDescription: "" })
            return
          }
          const picked = options.find((o) => o.id === id)
          onChange({
            ...value,
            refObjectId: id,
            shortDescription: picked?.name ?? value.shortDescription,
          })
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={`Select a ${typeInfo?.singular.toLowerCase() ?? "dataset"}...`} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>None</SelectItem>
          {unresolved && (
            <SelectItem value={value.refObjectId!}>
              {value.shortDescription || value.refObjectId} (not found)
            </SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
    </div>
  )
}
