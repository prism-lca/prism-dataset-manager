// Read stored values, avoiding normalizer defaults such as a generated timestamp.
export function StoredAdminFields({value}:{value:unknown}) {
  if(!value||typeof value!=='object')return null
  const admin=value as Record<string,unknown>
  return <>{[['permanentDataSetURI','Permanent data set URI'],['timeStamp','Timestamp']].map(([key,label])=>typeof admin[key]==='string'&&admin[key]?<div key={key}><p className="text-sm font-medium">{label}</p><p className="text-muted-foreground whitespace-pre-wrap break-all text-sm">{admin[key] as string}</p></div>:null)}</>
}
