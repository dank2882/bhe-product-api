import {execFileSync} from 'node:child_process';
import {Firestore} from '@google-cloud/firestore';
export function repositoryLiveClient(){
 const subject=process.env.DEVELOPER_ACTOR_SUBJECT;
 if(!subject)throw Error('Set the verified individual DEVELOPER_ACTOR_SUBJECT');
 const project='location-map-985',db=new Firestore({projectId:project,databaseId:'chatgptstorage'});
 const service=JSON.parse(execFileSync('gcloud',['run','services','describe','bhe-product-api','--project='+project,'--region=us-west1','--format=json'],{encoding:'utf8'}));
 const env=service.spec.template.spec.containers[0].env;
 const secret=env.find(e=>e.name==='BHE_API_KEY')?.valueFrom?.secretKeyRef;
 if(!secret)throw Error('Existing backend secret reference missing');
 const key=execFileSync('gcloud',['secrets','versions','access',secret.key,'--secret='+secret.name,'--project='+project],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 async function request(mode,operation,args={},actor=subject,withKey=true){
  const headers={'content-type':'application/json','x-bhe-actor-sub':actor};if(withKey)headers['x-api-key']=key;
  const r=await fetch(service.status.url+'/repository/sources/'+mode,{method:'POST',headers,body:JSON.stringify({operation,arguments:args})});
  return {status:r.status,body:await r.json()};
 }
 return {db,request,service,subject};
}
