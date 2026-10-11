import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { LANGS, getLangText, setLangText, type LangText } from "@/lib/ilcd"

interface LangTextFieldProps {
  label: string
  value: LangText[]
  onChange: (value: LangText[]) => void
  required?: boolean
  multiline?: boolean
  id?: string
}

export function LangTextField({
  label,
  value,
  onChange,
  required,
  multiline,
  id,
}: LangTextFieldProps) {
  const Field = multiline ? Textarea : Input
  const [newLanguage, setNewLanguage] = useState("")
  const [languageError, setLanguageError] = useState("")
  const languages = [...new Set([...LANGS, ...value.map(v => v.lang)])]
  function addLanguage() {
    try {
      const [lang] = Intl.getCanonicalLocales(newLanguage.trim())
      if (!lang) throw new Error()
      if (!languages.includes(lang)) onChange([...value, { lang, text: "" }])
      setNewLanguage(""); setLanguageError("")
    } catch { setLanguageError("Enter a language code such as fr or de.") }
  }
  return (
    <div className="flex flex-col gap-3">
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <div className={multiline ? "flex flex-col gap-4" : "grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2"}>
        {languages.map((lang) => (
          <div key={lang} className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-sm">
              {lang === "en" ? "English" : lang === "zh" ? "简体中文" : lang}
            </span>
            <Field
              id={id ? `${id}-${lang}` : undefined}
              aria-label={`${label} (${lang})`}
              required={required && !value.some(v => v.text.trim()) && lang === "en"}
              value={getLangText(value, lang)}
              onChange={(e) => onChange(setLangText(value, lang, e.target.value))}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input aria-label={`Additional language for ${label}`} placeholder="Language code (fr, de…)" value={newLanguage} onChange={e => setNewLanguage(e.target.value)} className="max-w-48" />
        <Button type="button" variant="outline" size="sm" onClick={addLanguage}>Add language</Button>
      </div>
      {languageError && <p role="alert" className="text-sm text-destructive">{languageError}</p>}
    </div>
  )
}
