'use strict';
const {publicEntry,thumbnail}=require('./repository-library-service');
const fail=message=>{throw Object.assign(new Error(message),{statusCode:400});};
const matches=(e,term)=>!term||[e.title,e.description,e.content,e.prompt,e.sourceNotes,...(e.tags||[])].join('\n').toLowerCase().includes(term);
async function count(q){return (await q.count().get()).data().count;}
async function browse(input,deps){
 if(input.query!==undefined&&typeof input.query!=='string')fail('Invalid search text');
 const gallery=input.operation==='gallery',scope=input.scope||'folder',limit=input.limit??(gallery?24:30),term=(input.query||'').trim().toLowerCase();
 if(typeof input.query!=='undefined'&&typeof input.query!=='string'||term.length>500||!Number.isInteger(limit)||limit<1||limit>(gallery?48:100))fail('Invalid library query');
 if(!['folder','all'].includes(scope)||input.kind&&!['image','folder','note'].includes(input.kind))fail('Invalid scope or kind');
 for(const value of [input.folderId,input.after])if(value&&!/^[a-zA-Z0-9_-]{1,100}$/.test(value))fail('Invalid library identifier');
 const folderAfter=gallery&&input.after?.startsWith('folders-')?input.after.slice(8):'',imageAfter=folderAfter?'':input.after;
 const folderId=input.folderId||'',cache=new Map();
 async function folder(id){if(!cache.has(id)){const s=await deps.entries.doc(id).get();if(!s.exists||s.data().kind!=='folder')fail('Repository folder not found');cache.set(id,s.data());}return cache.get(id);}
 async function ancestors(e){const result=[],seen=new Set();let id=e.folderId;while(id){if(seen.has(id)||seen.size>=30)fail('Invalid folder hierarchy');seen.add(id);const f=await folder(id);result.unshift({entryId:f.entryId,title:f.title});id=f.folderId;}return result;}
 if(folderId)await folder(folderId);
 let q=deps.entries;
 const kind=gallery?'image':input.kind;
 if(kind&&(gallery?scope==='folder':input.folderId!==undefined))q=q.where('activeFolderKey','==',kind+'|'+folderId);
 else {if(kind)q=q.where('activeKind','==',kind);if(!gallery&&input.folderId!==undefined)q=q.where('folderId','==',folderId);}
 let scan=q.orderBy('__name__');if(imageAfter)scan=scan.startAfter(deps.entries.doc(imageAfter));
 // Keep substring semantics without a full-catalog read. Search continues from
 // the last scanned record, including pages with no matches.
 const budget=term?300:limit+1,docs=(await scan.limit(budget).get()).docs;
 const selected=[];let scanned=0,last='';
 for(const d of docs){scanned++;last=d.id;const e=d.data();if(e.availability!=='unavailable'&&matches(e,term))selected.push(e);if(selected.length===limit)break;}
 const hasMore=scanned<docs.length||docs.length===budget;
 const nextAfter=hasMore?last:null;
 const totalMatches=!term?await count(q):null;
 if(!gallery)return {entries:selected.map(publicEntry),count:selected.length,totalMatches,nextAfter,searchType:'keyword',coverage:{complete:!hasMore,scanned,paginated:true}};
 const allImages=deps.entries.where('activeKind','==','image');
 let fq=scope==='folder'?deps.entries.where('activeFolderKey','==','folder|'+folderId):deps.entries.where('activeKind','==','folder');fq=fq.orderBy('__name__');if(folderAfter)fq=fq.startAfter(deps.entries.doc(folderAfter));
 const folderDocs=(await fq.limit(101).get()).docs;
 const folders=[];
 for(const d of folderDocs.slice(0,100)){
  const f=d.data();cache.set(f.entryId,f);if(f.availability==='unavailable'||term&&!matches(f,term))continue;
  const [imageCount,totalImageCount]=await Promise.all([count(deps.entries.where('activeFolderKey','==','image|'+f.entryId)),count(deps.entries.where('imageAncestorIds','array-contains',f.entryId))]);
  folders.push({entryId:f.entryId,title:f.title,folderId:f.folderId,imageCount,totalImageCount,path:await ancestors(f)});
 }
 folders.sort((a,b)=>a.title.localeCompare(b.title));
 const images=[];for(const e of selected){const card={entryId:e.entryId,title:e.title,folderId:e.folderId,folderPath:await ancestors(e),description:e.description,sourceType:e.sourceType,width:e.width,height:e.height,tags:e.tags,createdAt:e.createdAt};try{card.thumbnail=await thumbnail(e,deps);}catch{card.thumbnail=null;card.thumbnailError='Preview unavailable; refresh to retry.';}images.push(card);}
 const selectedFolder=folderId?await folder(folderId):null;
 return {folderId,scope,query:input.query||'',breadcrumbs:[{entryId:'',title:'All folders'},...(selectedFolder?[...await ancestors(selectedFolder),{entryId:folderId,title:selectedFolder.title}]:[])],folders,nextFoldersAfter:folderDocs.length>100?'folders-'+folderDocs[99].id:null,images,totalImages:await count(allImages),totalMatches,nextAfter,coverage:{complete:!hasMore,scanned,paginated:true,foldersComplete:folderDocs.length<=100},generatedAt:new Date().toISOString()};
}
module.exports={browse};
