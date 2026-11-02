import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(new URL('../package.json',import.meta.url))('playwright');
const origin=process.argv[2]??'https://app.picktennt.com';
const browser=await chromium.launch({channel:'chrome',headless:true});
let refreshFinished=false,authorizeAfterRefresh=false,challenge;
try {
 const context=await browser.newContext();
 if(new URL(origin).hostname!=='app.picktennt.com') {
  const auth=JSON.parse(await readFile(path.join(process.env.APPDATA,'com.vercel.cli','Data','auth.json'),'utf8'));
  const project=await(await fetch('https://api.vercel.com/v9/projects/prj_huFwDShek0jT1QZGtJNfEduYQiN3?teamId=team_6PPwzLtm2BHwoqK3P50y9FtW',{headers:{Authorization:`Bearer ${auth.token}`}})).json();
  const bypass=Object.entries(project.protectionBypass).find(([,value])=>value.scope==='automation-bypass')[0];
  await context.route(origin+'/**',route=>route.continue({headers:{...route.request().headers(),'x-vercel-protection-bypass':bypass}}));
 }
 await context.route('https://qmiljmxnnryhuaudpuff.supabase.co/auth/v1/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/token')) {
   if(route.request().method()==='OPTIONS'){await route.fulfill({status:200,headers:{'access-control-allow-origin':origin,'access-control-allow-headers':'*'},body:'{}'});return;}
   await new Promise(resolve=>setTimeout(resolve,700));
   await route.fulfill({status:400,contentType:'application/json',headers:{'access-control-allow-origin':origin,'access-control-expose-headers':'X-Supabase-Api-Version','X-Supabase-Api-Version':'2024-01-01'},body:JSON.stringify({code:'refresh_token_not_found',error_code:'refresh_token_not_found',msg:'Invalid Refresh Token: Refresh Token Not Found'})});
   refreshFinished=true;return;
  }
  if(url.pathname.endsWith('/authorize')) {
   authorizeAfterRefresh=refreshFinished;challenge=url.searchParams.get('code_challenge');
   await new Promise(resolve=>setTimeout(resolve,1500));
   await route.fulfill({contentType:'text/html',body:'<h1>Fixture Google authorization</h1>'});return;
  }
  await route.abort();
 });
 const page=await context.newPage();
 await page.goto(origin+'/login');await page.getByRole('button',{name:'Continue with Google'}).waitFor();
 const stale={access_token:'fixture.invalid.token',refresh_token:'fixture-expired-refresh',expires_at:1,user:{id:'fixture-user'}};
 await context.addCookies([{name:'sb-qmiljmxnnryhuaudpuff-auth-token',value:'base64-'+Buffer.from(JSON.stringify(stale)).toString('base64url'),url:origin,sameSite:'Lax'}]);
 await page.getByRole('button',{name:'Continue with Google'}).click();
 await page.getByRole('heading',{name:'Fixture Google authorization'}).waitFor();
 await page.waitForTimeout(1000);
 const cookie=(await context.cookies(origin)).find(cookie=>cookie.name==='sb-qmiljmxnnryhuaudpuff-auth-token-code-verifier');
 let matches=false;
 if(cookie){const value=cookie.value.startsWith('base64-')?Buffer.from(cookie.value.slice(7),'base64url').toString():cookie.value;const verifier=JSON.parse(value).split('/')[0];matches=createHash('sha256').update(verifier).digest('base64url')===challenge;}
 const report={origin,fixtureOnly:true,refreshFinished,authorizeAfterRefresh,verifierSurvives:!!cookie,challengeMatches:matches,passed:authorizeAfterRefresh&&matches};
 await writeFile('docs/design/idd-auth/google-first-attempt-'+(new URL(origin).hostname==='app.picktennt.com'?'live':'staged')+'.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));assert.ok(report.passed,'Stale-session cleanup must finish before creating the new OAuth verifier');
} finally {await browser.close();}

