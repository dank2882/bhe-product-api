'use strict';
const {createHash}=require('node:crypto');
const sharp=require('sharp');
const ROOT='/Knowledge Repository/Images',ROOT_ID='id:GYjHJT2OzPAAAAAAABT5jg',NAMESPACE='10251589472';
const MAX=25*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function error(code,statusCode=502){return Object.assign(new Error(code),{code,statusCode});}
function inside(path){return typeof path==='string'&&(path.toLowerCase()===ROOT.toLowerCase()||path.toLowerCase().startsWith(ROOT.toLowerCase()+'/'))&&!path.split('/').some(s=>s==='.'||s==='..'||s.includes('\\'));}
function segment(value){return String(value).normalize('NFC').replace(/[\/\\\x00-\x1f<>:"|?*]/g,'-').replace(/[. ]+$/g,'').slice(0,100)||'Untitled';}
async function bytes(response,max=MAX){
 if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();throw error('Image exceeds 25 MB',413);}
 const parts=[];let size=0;for await(const part of response.body){size+=part.length;if(size>max)throw error('Image exceeds 25 MB',413);parts.push(part);}return Buffer.concat(parts);
}
class DropboxStorage {
 constructor({refreshToken,clientId='1uc5jjc72th381b',fetchImpl=fetch}){if(!refreshToken)throw error('Dropbox is not configured',503);this.refreshToken=refreshToken;this.clientId=clientId;this.fetch=fetchImpl;}
 async token(){
  if(this.access&&Date.now()<this.until)return this.access;
  if(!this.refreshing)this.refreshing=(async()=>{const r=await this.fetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),body:new URLSearchParams({grant_type:'refresh_token',refresh_token:this.refreshToken,client_id:this.clientId})});if(!r.ok)throw error('Dropbox authorization unavailable',503);const v=await r.json();if(!v.access_token||!Number.isFinite(v.expires_in))throw error('Dropbox authorization invalid',503);this.access=v.access_token;this.until=Date.now()+Math.max(0,v.expires_in-60)*1000;return this.access;})().finally(()=>{this.refreshing=null;});
  return this.refreshing;
 }
 async request(operation,args,body){
  const content=body!==undefined||operation==='files/download';
  const headers={Authorization:'Bearer '+await this.token(),'Dropbox-API-Path-Root':JSON.stringify({'.tag':'namespace_id',namespace_id:NAMESPACE})};
  if(content){headers['Dropbox-API-Arg']=JSON.stringify(args).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));if(body!==undefined)headers['Content-Type']='application/octet-stream';}
  else headers['Content-Type']='application/json';
  const response=await this.fetch(`https://${content?'content':'api'}.dropboxapi.com/2/${operation}`,{method:'POST',headers,body:content?body:JSON.stringify(args),redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok){const e=error('Dropbox operation unavailable',response.status===429?503:502);e.providerStatus=response.status;const data=await response.json().catch(()=>({}));e.providerTag=data.error?.['.tag'];e.pathTag=data.error?.path?.['.tag'];throw e;}
  return response;
 }
 async metadata(path){if(!path.startsWith('id:')&&!inside(path))throw error('Image outside repository root',403);const m=await(await this.request('files/get_metadata',{path})).json();if(!inside(m.path_lower))throw error('Image outside repository root',403);return m;}
 async checkRoot(){const m=await this.metadata(ROOT);if(m.id!==ROOT_ID||m['.tag']!=='folder')throw error('Repository Dropbox root changed',409);return m;}
 async folder(path){if(!inside(path))throw error('Invalid repository folder',403);try{return await(await this.request('files/create_folder_v2',{path,autorename:false})).json();}catch(e){if(e.providerStatus!==409)throw e;const m=await this.metadata(path);if(m['.tag']!=='folder')throw error('Dropbox folder conflicts with file',409);return {metadata:m};}}
 async read(ref){
  const current=await this.metadata(ref.fileId);if(current['.tag']!=='file'||current.rev!==ref.rev)throw error('Image changed in Dropbox; refresh the library',409);
  if(current.size>MAX)throw error('Image exceeds 25 MB',413);
  const r=await this.request('files/download',{path:'rev:'+ref.rev});
  let m;try{m=JSON.parse(r.headers.get('dropbox-api-result'));}catch{throw error('Missing Dropbox download receipt');}
  if(m.id!==ref.fileId||m.rev!==ref.rev||!inside(m.path_lower))throw error('Dropbox download reference changed',409);
  const b=await bytes(r);if(ref.checksumSha256&&digest(b)!==ref.checksumSha256)throw error('Dropbox checksum mismatch',409);return b;
 }
 async put(path,buffer){
  if(!inside(path)||buffer.length>MAX)throw error('Invalid image destination or size',400);
  let m;try{m=await(await this.request('files/upload',{path,mode:'add',autorename:false,mute:true,strict_conflict:true},buffer)).json();}
  catch(e){if(e.providerStatus!==409)throw e;m=await this.metadata(path);}
  if(!m.id||!m.rev||!inside(m.path_lower)||m['.tag']&&m['.tag']!=='file')throw error('Invalid Dropbox upload receipt');
  const ref={provider:'dropbox',fileId:m.id,rev:m.rev,path:m.path_display,checksumSha256:digest(buffer)};
  await this.read(ref);return ref;
 }
 async saveImage(prepared,entry,folders=[]){
  await this.checkRoot();let path=ROOT;const folderBindings=[];
  for(const folder of folders){path+='/'+segment(folder.title)+'--'+folder.entryId;const result=await this.folder(path);folderBindings.push({entryId:folder.entryId,fileId:result.metadata.id,path:result.metadata.path_lower});}
  const original=await this.put(`${path}/${segment(entry.title)}--${entry.entryId}.${prepared.extension}`,prepared.bytes);
  return {...original,folderBindings,preview:await this.preview(prepared.bytes,entry.entryId,prepared.checksumSha256)};
 }
 async preview(buffer,entryId,checksum){
  if(!/^[a-zA-Z0-9_-]+$/.test(entryId)||!/^[a-f0-9]{64}$/.test(checksum))throw error('Invalid preview identity',400);
  await this.folder(ROOT+'/_previews');
  const preview=await sharp(buffer,{limitInputPixels:40000000}).rotate().resize({width:480,height:360,fit:'inside',withoutEnlargement:true}).webp({quality:78}).toBuffer();
  return this.put(`${ROOT}/_previews/${entryId}-${checksum}.webp`,preview);
 }
 async changes(cursor){await this.checkRoot();return (await this.request(cursor?'files/list_folder/continue':'files/list_folder',cursor?{cursor}:{path:ROOT,recursive:true,include_deleted:true,limit:100})).json();}
}
module.exports={DropboxStorage,ROOT,ROOT_ID,NAMESPACE,inside,segment,digest,MAX};
