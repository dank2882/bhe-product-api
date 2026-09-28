'use strict';
const {createHmac,timingSafeEqual}=require('node:crypto');
function invalid(){throw Object.assign(new Error('Image link expired or invalid'),{statusCode:403});}
function signature(payload,key){return createHmac('sha256',key).update('bhe-repository-image-v1\n'+payload).digest('base64url');}
function link(entry,variant,subject,{mediaOrigin,mediaKey},now=Date.now()){
 if(!mediaKey||!mediaOrigin)throw Object.assign(new Error('Image delivery is not configured'),{statusCode:503});
 const origin=new URL(mediaOrigin);if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Invalid media origin');
 const expires=now+15*60*1000;
 const payload=Buffer.from(JSON.stringify({id:entry.entryId,version:entry.version,variant,subject,expires})).toString('base64url');
 return {url:`${origin.origin}/repository/library/media/${payload}.${signature(payload,mediaKey)}`,expiresAt:new Date(expires).toISOString()};
}
function verify(token,key,now=Date.now()){
 if(!key||typeof token!=='string'||token.length>3000)invalid();
 const parts=token.split('.');if(parts.length!==2)invalid();
 const expected=signature(parts[0],key),supplied=parts[1];
 if(supplied.length!==expected.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))invalid();
 let value;try{value=JSON.parse(Buffer.from(parts[0],'base64url'));}catch{invalid();}
 if(!Number.isSafeInteger(value.expires)||value.expires<=now||value.expires>now+15*60*1000||!Number.isSafeInteger(value.version)||value.version<1||!['original','preview'].includes(value.variant)||typeof value.subject!=='string'||!value.subject||!/^entry-[a-zA-Z0-9_-]+$/.test(value.id))invalid();
 return value;
}
module.exports={link,verify};
