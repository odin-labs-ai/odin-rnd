import {createHash} from 'node:crypto';
export const clone = value => structuredClone(value);
export function canonical(value) {return JSON.stringify(sort(value));}
function sort(v) {return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
export const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
export function entropy(seed, bytes) {let text='';for(let i=0;text.length<bytes;i++)text+=createHash('sha256').update(`${seed}:${i}`).digest('base64');return text.slice(0,bytes);}
export function sessionFixtures({count=1000,tenants=10,payloadBytes=8192,seed='primary',sessionProfile='known-hot'}={}) {return Array.from({length:count},(_,i)=>({tenantId:`tenant-${i%tenants}`,id:`session-${String(i).padStart(6,'0')}`,version:0,payload:{cold:entropy(`${seed}:session-${i}`,payloadBytes),hot:{value:0},...(sessionProfile==='known-hot'?{}:{tools:Object.fromEntries(Array.from({length:32},(_,t)=>[`tool${t}`,{a:0,b:0}]))})}}));}
export function attributeFixtures({count=10000,tenants=10,keyCount=200,attributesPerDocument=20,seed='primary'}={}) {return Array.from({length:count},(_,i)=>{const offset=createHash('sha256').update(String(seed)).digest().readUInt16BE(0);const attrs={};for(let j=0;j<attributesPerDocument;j++){const k=(i*37+j*11)%keyCount;attrs[`k${String(k).padStart(3,'0')}`]=(i+j+offset)%11===0?null:k%5===0?`value-${(i*7+j+offset)%100}`:(i*13+j*7+offset)%1000;}return {tenantId:`tenant-${i%tenants}`,id:`attribute-${String(i).padStart(6,'0')}`,attrs};});}
export function queryFixtures({records=attributeFixtures(),limit=20}={}) {
 const queries=[];
 for(const [group,pairs] of [['known',[[1,5],[17,15]]],['withheld',[[137,135],[173,175]]]]){
  const usedTenants=new Set();
  for(const [numericKey,stringKey] of pairs){
   const numeric=`k${String(numericKey).padStart(3,'0')}`,string=`k${String(stringKey).padStart(3,'0')}`;
   const tenants=[...new Set(records.map(r=>r.tenantId))].sort();
   let chosen;
   for(const tenantId of tenants){
    if(usedTenants.has(tenantId))continue;
    const rows=records.filter(r=>r.tenantId===tenantId).sort((a,b)=>a.id.localeCompare(b.id));
    const numericRow=rows.find(r=>typeof r.attrs[numeric]==='number');
    const stringRow=rows.find(r=>typeof r.attrs[string]==='string');
    if(numericRow&&stringRow&&rows.some(r=>typeof r.attrs[numeric]==='number'&&r.attrs[numeric]>=300&&r.attrs[numeric]<700)&&rows.some(r=>Object.hasOwn(r.attrs,numeric)&&r.attrs[numeric]===null)){chosen={tenantId,numericRow,stringRow};break;}
   }
   if(!chosen)throw new Error(`No positive query fixture coverage for ${group}/${numeric}/${string}`);
   usedTenants.add(chosen.tenantId);
   for(const q of [
    {class:'numeric-equality-positive',key:numeric,op:'eq',value:chosen.numericRow.attrs[numeric]},
    {class:'string-equality-positive',key:string,op:'eq',value:chosen.stringRow.attrs[string]},
    {class:'numeric-range',key:numeric,op:'range',min:300,max:700},
    {class:'explicit-null',key:numeric,op:'null'},
    {class:'exists',key:numeric,op:'exists'},
   ])queries.push({...q,tenantId:chosen.tenantId,group,limit});
  }
 }
 return queries;
}
export function negativeQueryFixtures({tenantId='tenant-0'}={}) {return [
 {tenantId,key:'k001',op:'eq',value:-1,limit:null,class:'empty-match'},
 {tenantId,key:'k001',op:'eq',value:'wrong-type',limit:null,class:'wrong-type'},
 {tenantId,key:'k999',op:'exists',limit:null,class:'absent-key'},
];}
export const distributedPaths = () => Array.from({length:32},(_,i)=>['a','b'].map(k=>['tools',`tool${i}`,k])).flat();
