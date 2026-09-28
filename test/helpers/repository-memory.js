'use strict';
function memory(initial={}){
 const records=new Map(Object.entries(initial));const reads=[];
 function collection(name){
  function ref(id){const path=name+'/'+id;return {id,path,async get(){return snapshot(path);}};}
  function snapshot(path){return {id:path.split('/').at(-1),ref:collection(name).doc(path.split('/').at(-1)),exists:records.has(path),data:()=>structuredClone(records.get(path))};}
  function query(filters=[],orders=[],after=[],limit=Infinity){return {doc:ref,where:(...filter)=>query([...filters,filter],orders,after,limit),orderBy:(field)=>query(filters,[...orders,field],after,limit),startAfter:(...values)=>query(filters,orders,values,limit),limit:n=>query(filters,orders,after,n),count:()=>({get:async()=>({data:()=>({count:select().length})})}),get:async()=>{reads.push({name,limit,filters});return {docs:select().slice(0,limit).map(([path])=>snapshot(path))};}};
  function select(){return [...records].filter(([path,e])=>path.startsWith(name+'/')&&filters.every(([field,op,val])=>op==='=='?e[field]===val:op==='array-contains'?e[field]?.includes(val):op==='>='?e[field]>=val:e[field]<val)).sort(([pa,a],[pb,b])=>{for(const order of orders){const aa=order==='__name__'?pa:a[order],bb=order==='__name__'?pb:b[order];if(aa<bb)return -1;if(aa>bb)return 1;}return 0;}).filter(([path,e])=>{if(!after.length)return true;for(let i=0;i<orders.length;i++){const v=orders[i]==='__name__'?path:e[orders[i]],cut=after[i]?.path||after[i];if(v>cut)return true;if(v<cut)return false;}return false;});}
  }
  return query();
 }
 const db={collection,async runTransaction(fn){const changes=[];const result=await fn({get:r=>r.get(),set:(r,v)=>changes.push(()=>records.set(r.path,structuredClone(v))),update:(r,v)=>changes.push(()=>records.set(r.path,{...records.get(r.path),...structuredClone(v)})),create:(r,v)=>{if(records.has(r.path))throw Error('Already exists');changes.push(()=>records.set(r.path,structuredClone(v)));}});changes.forEach(f=>f());return result;}};
 return {db,entries:collection('entries'),audit:collection('audit'),records,reads};
}
module.exports={memory};
