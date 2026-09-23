import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=await readFile(new URL('../app/api/tournaments/[id]/lookup-dupr/route.ts',import.meta.url),'utf8');
let signedIn=true, member=false, serviceUses=0;
const normal={auth:{getUser:async()=>({data:{user:signedIn?{id:'caller'}:null}})},from:()=>{
 const query={select:()=>query,eq:()=>query,single:async()=>({data:{id:'caller-admin'}}),maybeSingle:async()=>({data:member?{id:'member'}:null})};return query;
}};
const service={from:()=>{const query={select:()=>query,eq:()=>query,update:()=>query,
 single:async()=>({data:{id:'player',first_name:'Test',last_name:'Player'}}),
 then:resolve=>resolve({error:null})};return query;}};
const context=vm.createContext({Request,Response,NextResponse:{json:Response.json},process:{env:{}},
 createClient:async()=>normal,createSupabaseClient:()=>{serviceUses++;return service;},searchDuprPlayers:async()=>[]});
vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'').replaceAll('export async function','async function'))+'\nglobalThis.handlers={POST,PATCH};',context);
const target={profile_id:'00000000-0000-0000-0000-000000000002',dupr_id:'VALID123'};
for(const method of ['POST','PATCH']){
 const request=()=>new Request('https://test.invalid',{method,body:JSON.stringify(target)});
 const ctx={params:Promise.resolve({id:'00000000-0000-0000-0000-000000000001'})};
 signedIn=false; serviceUses=0;assert.equal((await context.handlers[method](request(),ctx)).status,401);assert.equal(serviceUses,0);
 signedIn=true; member=false;serviceUses=0;assert.equal((await context.handlers[method](request(),ctx)).status,403);assert.equal(serviceUses,0);
 member=true;assert.equal((await context.handlers[method](request(),ctx)).status,200);assert.equal(serviceUses,1);
 console.log('PASS '+method+': unauthenticated and cross-tournament targets fail before service-role access; in-tournament target succeeds');
}
