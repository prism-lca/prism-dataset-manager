import { LANG_LABELS, type LangText } from "@/lib/ilcd"

export function LangRow({ label, value }: { label: string; value: LangText[] }) {
  if (value.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">{label}</p>
      {value.map(({ lang, text }, index) => {
        if (!text) return null
        return (
          <p key={`${lang}-${index}`} className="text-muted-foreground whitespace-pre-wrap break-words text-sm">
            <span className="mr-2 text-xs">{LANG_LABELS[lang] ?? lang}</span>
            {text}
          </p>
        )
      })}
    </div>
  )
}
