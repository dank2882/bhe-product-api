'use strict';
const {randomUUID}=require('node:crypto');
const sharp=require('sharp');
const {ROOT,digest,MAX}=require('./repository-dropbox-storage');
const key=id=>digest(id).slice(0,32);
const isPreview=path=>path.toLowerCase()===ROOT.toLowerCase()+'/_previews'||path.toLowerCase().startsWith(ROOT.toLowerCase()+'/_previews/');
async function sync(deps,{force=false}={}){
 const stateRef=deps.db.collection('repositoryLibrarySync').doc('dropbox'),owner=randomUUID(),now=Date.now();
 const state=await deps.db.runTransaction(async tx=>{const s=(await tx.get(stateRef)).data()||{};if(s.leaseUntil>now||!force&&s.checkedAt>now-60000)return null;tx.set(stateRef,{...s,leaseOwner:owner,leaseUntil:now+15*60*1000});return s;});
 if(!state)return {status:'current_or_syncing'};
 async function commit(fn){return deps.db.runTransaction(async tx=>{const s=(await tx.get(stateRef)).data();if(s.leaseOwner!==owner||s.leaseUntil<Date.now())throw Error('Dropbox sync lease expired');await fn(tx);});}
 async function update(ref,prior,patch,action){await commit(async tx=>{const current=await tx.get(ref);if((current.data()?.version||0)!==(prior?.version||0))throw Error('Concurrent repository update; retry sync');const next={...prior,...patch,version:(prior?.version||0)+1};next.activeKind=next.availability==='unavailable'?'unavailable':next.kind;next.activeFolderKey=next.availability==='unavailable'?'unavailable':next.kind+'|'+(next.folderId||'');if(next.availability==='unavailable')next.imageAncestorIds=[];tx.set(ref,next);tx.create(deps.audit.doc(randomUUID()),{entryId:ref.id,action,createdAt:new Date().toISOString(),source:'dropbox_change_cursor'});});}
 async function find(field,value){const r=await deps.entries.where(field,'==',value).limit(2).get();if(r.docs.length>1)throw Error('Duplicate Dropbox reference');return r.docs[0];}
 const folderCache=new Map();
 async function folder(path,depth=0){
  if(path.toLowerCase()===ROOT.toLowerCase())return {entryId:'',ancestors:[]};
  if(depth>30)throw Error('Dropbox folder hierarchy too deep');
  if(folderCache.has(path))return folderCache.get(path);
  const m=await deps.dropbox.metadata(path),parent=await folder(path.slice(0,path.lastIndexOf('/')),depth+1);
  const found=await find('dropboxFolderId',m.id),entryId=found?.id||'folder-'+key(m.id),prior=found?.data();
  const patch={entryId,kind:'folder',title:prior?.title||m.name,folderId:parent.entryId,dropboxFolderId:m.id,dropboxPathLower:m.path_lower,availability:'available',owner:'bhe',visibility:'repository_staff',createdAt:prior?.createdAt||new Date().toISOString()};
  if(!prior||prior.folderId!==patch.folderId||prior.dropboxPathLower!==m.path_lower||prior.availability==='unavailable')await update(deps.entries.doc(entryId),prior,patch,'index_dropbox_folder');
  const value={entryId,ancestors:[...parent.ancestors,parent.entryId].filter(Boolean)};folderCache.set(path,value);return value;
 }
 try{
  let pending=state.pending||[],cursor=state.cursor||null,hasMore=state.hasMore||false;
  if(!pending.length){
   let page;try{page=await deps.dropbox.changes(cursor);}catch(e){if(e.providerTag!=='reset')throw e;cursor=null;page=await deps.dropbox.changes(null);state.reconcileAfter='';state.reconciling=true;}
   pending=page.entries.map(m=>Object.fromEntries(['.tag','id','name','path_lower','path_display','rev','size'].filter(k=>m[k]!==undefined).map(k=>[k,m[k]])));
   cursor=page.cursor;hasMore=page.has_more;
  }
  let processed=0,images=0;
  while(pending.length&&processed<30&&images<5){
   const m=pending[0];
   if(!m.path_lower||isPreview(m.path_lower)){pending.shift();processed++;continue;}
   if(m['.tag']==='deleted'){
    // A deleted folder may be the only event for all of its descendants.
    const exact=await deps.entries.where('dropboxPathLower','==',m.path_lower).limit(5).get();
    for(const d of exact.docs)if(d.data().availability!=='unavailable')await update(d.ref,d.data(),{availability:'unavailable'},'dropbox_file_unavailable');
    let q=deps.entries.where('dropboxPathLower','>=',m.path_lower+'/').where('dropboxPathLower','<',m.path_lower+'/\uf8ff').orderBy('dropboxPathLower').orderBy('__name__');
    if(m.deleteAfter)q=q.startAfter(m.deleteAfter.path,deps.entries.doc(m.deleteAfter.id));
    const descendants=await q.limit(100).get();
    for(const d of descendants.docs)if(d.data().availability!=='unavailable')await update(d.ref,d.data(),{availability:'unavailable'},'dropbox_folder_unavailable');
    if(descendants.docs.length===100){const last=descendants.docs.at(-1);m.deleteAfter={path:last.data().dropboxPathLower,id:last.id};break;}
   }else if(m['.tag']==='folder'){
    state.reconciling=true;state.reconcileAfter='';
    // Fetch current metadata: a queued creation can have been moved/deleted already.
    try{await folder(m.path_display);}catch(e){if(e.providerStatus!==409)throw e;}
   }else if(m['.tag']==='file'){
    const found=await find('dropboxFileId',m.id),prior=found?.data();
    // Backend uploads reserve this filename suffix; do not race their catalog commit.
    if(!prior&&/--entry-[a-f0-9]{32}\.(png|jpg|webp)$/i.test(m.name)){pending.shift();processed++;continue;}
    if(!/\.(png|jpe?g|webp)$/i.test(m.name)||m.size>MAX){
     if(prior&&prior.availability!=='unavailable')await update(found.ref,prior,{availability:'unavailable'},'dropbox_image_unsupported');
     pending.shift();processed++;continue;
    }
    let current;try{current=await deps.dropbox.metadata(m.id);}catch(e){if(e.providerStatus!==409&&e.statusCode!==403)throw e;if(prior)await update(found.ref,prior,{availability:'unavailable'},'dropbox_file_unavailable');pending.shift();processed++;continue;}
    if(current.size>MAX){if(prior)await update(found.ref,prior,{availability:'unavailable'},'dropbox_image_unsupported');pending.shift();processed++;continue;}
    const parent=await folder(current.path_display.slice(0,current.path_display.lastIndexOf('/')));
    const entryId=found?.id||'entry-'+key(m.id),ref=deps.entries.doc(entryId);
    if(prior?.storage?.rev===current.rev){
     if(prior.dropboxPathLower!==current.path_lower||prior.folderId!==parent.entryId||prior.availability==='unavailable')await update(ref,prior,{dropboxPathLower:current.path_lower,folderId:parent.entryId,imageAncestorIds:[...parent.ancestors,parent.entryId].filter(Boolean),availability:'available',storage:{...prior.storage,path:current.path_display}},'dropbox_image_moved');
    }else{
     const storage={provider:'dropbox',fileId:current.id,rev:current.rev,path:current.path_display};
     const bytes=await deps.dropbox.read(storage);let info;
     try{info=await sharp(bytes,{limitInputPixels:40000000}).metadata();await sharp(bytes,{limitInputPixels:40000000}).stats();if(!['png','jpeg','webp'].includes(info.format)||info.pages>1)throw Error('unsupported');}
     catch{if(prior)await update(ref,prior,{availability:'unavailable'},'dropbox_image_invalid');pending.shift();processed++;continue;}
     storage.checksumSha256=digest(bytes);storage.preview=await deps.dropbox.preview(bytes,entryId,storage.checksumSha256);
     const patch={entryId,kind:'image',title:prior?.title||current.name.replace(/\.[^.]+$/,''),folderId:parent.entryId,storage,dropboxFileId:current.id,dropboxPathLower:current.path_lower,imageAncestorIds:[...parent.ancestors,parent.entryId].filter(Boolean),checksumSha256:storage.checksumSha256,sizeBytes:bytes.length,width:info.width,height:info.height,contentType:'image/'+info.format,fileName:current.name,availability:'available',owner:'bhe',visibility:'repository_staff',createdAt:prior?.createdAt||new Date().toISOString(),description:prior?.description||'',tags:prior?.tags||[],prompt:prior?.prompt||'',sourceType:prior?.sourceType||'unspecified',sourceNotes:prior?.sourceNotes||'Indexed from the BHE Dropbox Images folder. Original creation provenance was not supplied.',externalRevisionChanged:Boolean(prior),createdBy:prior?.createdBy||{subject:'system:dropbox-index',name:'Dropbox indexing'}};
     await update(ref,prior,patch,'index_dropbox_image');images++;
    }
   }
   pending.shift();processed++;
  }
  // After an invalid cursor, reconcile stale entries in bounded pages. Direct
  // metadata checks avoid deleting records merely absent from a partial scan.
  if(state.reconciling&&!pending.length&&!hasMore){
   let q=deps.entries.orderBy('__name__');if(state.reconcileAfter)q=q.startAfter(deps.entries.doc(state.reconcileAfter));
   const page=await q.limit(50).get();
   for(const d of page.docs){const e=d.data();if(e.storage?.provider!=='dropbox')continue;try{const current=await deps.dropbox.metadata(e.storage.fileId);if(current.rev!==e.storage.rev||current.path_lower!==e.dropboxPathLower||e.availability==='unavailable')pending.push(Object.fromEntries(['.tag','id','name','path_lower','path_display','rev','size'].filter(k=>current[k]!==undefined).map(k=>[k,current[k]])));}catch(err){if(err.providerStatus!==409&&err.statusCode!==403)throw err;if(e.availability!=='unavailable')await update(d.ref,e,{availability:'unavailable'},'dropbox_reconcile_unavailable');}}
   state.reconcileAfter=page.docs.at(-1)?.id||state.reconcileAfter;state.reconciling=page.docs.length===50;
  }
  await commit(async tx=>tx.set(stateRef,{cursor,pending,hasMore,checkedAt:Date.now(),leaseOwner:'',leaseUntil:0,reconciling:Boolean(state.reconciling),reconcileAfter:state.reconcileAfter||''}));
  return {status:pending.length||hasMore||state.reconciling?'indexing':'current',processed,images,more:Boolean(pending.length||hasMore||state.reconciling)};
 }catch(error){await deps.db.runTransaction(async tx=>{const s=(await tx.get(stateRef)).data();if(s?.leaseOwner===owner)tx.update(stateRef,{leaseOwner:'',leaseUntil:0});});throw error;}
}
module.exports={sync,isPreview};
