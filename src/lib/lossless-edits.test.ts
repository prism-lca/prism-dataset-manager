import { describe, expect, it } from 'vitest'
import { applyFormEdits } from './lossless-edits'
import { toProcessDataSet, toFlowDataSet, toModelDataSet, toContactDataSet, toSourceDataSet, toFlowPropertyDataSet, toUnitGroupDataSet, setLangText } from './ilcd'

describe('lossless form patches', () => {
  const normalize = [toProcessDataSet,toFlowDataSet,toModelDataSet,toContactDataSet,toSourceDataSet,toFlowPropertyDataSet,toUnitGroupDataSet]
  for (const fn of normalize) it(`${fn.name}: no-op retains exact payload without normalized defaults`, () => {
    const raw={unknown:{parameters:[{formula:'a*b'}]},administrativeInformation:{extra:'retain'}}
    const before=fn(raw)
    expect(applyFormEdits(raw,before,structuredClone(before)).payload).toEqual(raw)
  })
  it('one-field edit retains unknown root, nested and array-item data', () => {
    const raw={extra:42,exchanges:[{dataSetInternalID:1,meanAmount:2,uncertainty:{sigma:0.2}}]}
    const before=toProcessDataSet(raw),after=structuredClone(before)
    after.exchanges[0].meanAmount=3
    expect(applyFormEdits(raw,before,after).payload).toEqual({...raw,exchanges:[{...raw.exchanges[0],meanAmount:3}]})
    expect(raw.exchanges[0].meanAmount).toBe(2)
  })
  it('preserves array identity during reorder/add/delete and reports hidden data deletion', () => {
    const raw={items:[{dataSetInternalID:1,value:'a',extra:'first'},{dataSetInternalID:2,value:'b',extra:'second'}]}
    const before={items:raw.items.map(({dataSetInternalID,value})=>({dataSetInternalID,value}))}
    const after={items:[{...before.items[1],value:'edited'},{dataSetInternalID:3,value:'new'}]}
    const result=applyFormEdits(raw,before,after)
    expect(result.payload.items).toEqual([{...raw.items[1],value:'edited'},{dataSetInternalID:3,value:'new'}])
    expect(result.removedExtraPaths).toEqual(['/items/0'])
  })
  it('retains unknown properties on unkeyed surviving items after deletion', () => {
    const raw={items:[{value:'a',extra:1},{value:'b',extra:2}]}
    const before={items:[{value:'a'},{value:'b'}]},after={items:[before.items[1]]}
    expect(applyFormEdits(raw,before,after).payload.items).toEqual([raw.items[1]])
  })
  it('rejects ambiguous unkeyed replacements instead of discarding hidden fields', () => {
    const raw={items:[{value:'a',extra:1},{value:'b',extra:2}]}
    expect(()=>applyFormEdits(raw,{items:[{value:'a'},{value:'b'}]},{items:[{value:'edited'}]})).toThrow('Cannot safely identify')
  })
  it('matches unchanged cloned items and refuses multiple ambiguous item edits',()=>{
    const raw={items:[{value:'a',extra:1},{value:'b',extra:2}]}
    const before={items:[{value:'a'},{value:'b'}]}
    expect(applyFormEdits(raw,before,{items:[{value:'a'},{value:'changed'}]}).payload.items).toEqual([raw.items[0],{value:'changed',extra:2}])
    expect(()=>applyFormEdits(raw,before,{items:[{value:'changed-a'},{value:'changed-b'}]})).toThrow('one at a time')
  })
  it('preserves source language metadata during actual form text edits and warns when cleared',()=>{
    const raw={sourceInformation:{dataSetInformation:{shortName:[{lang:'fr',text:'Bonjour',sourceMetadata:{retain:true}}]}}}
    const before=toSourceDataSet(raw),after=structuredClone(before)
    after.sourceInformation.dataSetInformation.shortName=setLangText(after.sourceInformation.dataSetInformation.shortName,'fr','Modifié')
    const result=applyFormEdits(raw,before,after)
    expect(result.payload).toEqual({sourceInformation:{dataSetInformation:{shortName:[{...raw.sourceInformation.dataSetInformation.shortName[0],text:'Modifié'}]}}})
    after.sourceInformation.dataSetInformation.shortName=[]
    expect(applyFormEdits(raw,before,after).removedExtraPaths).toEqual(['/sourceInformation/dataSetInformation/shortName/0'])
  })
  it('preserves all language entries and extra per-language metadata', () => {
    const raw={name:[{lang:'fr',text:'Bonjour',extra:'retain'},{lang:'en',text:'Hello'}]}
    const before={name:[{lang:'fr',text:'Bonjour'},{lang:'en',text:'Hello'}]}
    expect(applyFormEdits(raw,before,{name:[{lang:'en',text:'Edited'},{lang:'fr',text:'Bonjour'}]}).payload.name).toEqual([{lang:'en',text:'Edited'},raw.name[0]])
  })
})
