"""Live concurrency checks using only explicitly provisioned Session Games QA accounts."""
import concurrent.futures, datetime, json, sys, urllib.request, urllib.error, uuid
accounts=json.load(open(sys.argv[1]))
assert len(accounts)==4 and all(a['email'].startswith('session-games-qa-') and a['email'].endswith('@example.com') for a in accounts)
checks=0
def rpc(i,name,data):
 a=accounts[i]
 req=urllib.request.Request(a['url']+'/rest/v1/rpc/'+name,data=json.dumps(data).encode(),headers={'apikey':a['apikey'],'Authorization':'Bearer '+a['access_token'],'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
 except urllib.error.HTTPError as e:return {'error':json.loads(e.read()).get('message')}
def check(value,label):
 global checks
 assert value,label
 checks+=1;print('PASS:',label,flush=True)
def parallel(*calls):
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:return list(pool.map(lambda f:f(),calls))
def mutate(i,op,g,data=None,oid=None):
 return rpc(i,'session_game_mutate',{'p_operation':op,'p_game_id':g['id'],'p_revision':g.get('revision'),'p_operation_id':oid or str(uuid.uuid4()),'p_data':data or {}})
sid=rpc(0,'play_session_create',{'p_title':'Live QA concurrency '+str(uuid.uuid4())[:5],'p_starts_at':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=1)).isoformat(),'p_duration_minutes':60,'p_timezone':'UTC','p_court_count':1,'p_location_name':'QA Courts','p_location_address':'Test fixture','p_max_players':2,'p_format':'random_player','p_description':'Simultaneous request verification','p_creator_is_playing':True})
join=lambda i:rpc(i,'play_session_join',{'p_session_id':sid,'p_pair_id':None,'p_seat_number':None})
results=parallel(lambda:join(1),lambda:join(2))
winners=[i+1 for i,r in enumerate(results) if not isinstance(r,dict) or 'error' not in r]
check(len(winners)==1,'exactly one simultaneous join takes final seat')
check(any(isinstance(r,dict) and 'SESSION_FULL' in r.get('error','') for r in results),'losing join receives SESSION_FULL')
scorer=winners[0]
data={'sessionId':sid,'playerIds':[accounts[0]['id'],accounts[scorer]['id']],'matchType':'SINGLES','scoringSystem':'SIDE_OUT','targetScore':11,'winByTwo':True,'scorerId':accounts[scorer]['id']}
g=mutate(0,'create',{'id':str(uuid.uuid4())},data)
results=parallel(lambda:mutate(scorer,'accept',g),lambda:mutate(scorer,'accept',g))
check(sum(r.get('status')=='ready' for r in results)==1,'one concurrent acceptance commits')
check(any('changed' in r.get('error','') for r in results),'stale concurrent acceptance is rejected')
g=next(r for r in results if r.get('status')=='ready');op=str(uuid.uuid4())
results=parallel(lambda:mutate(scorer,'start',g,oid=op),lambda:mutate(scorer,'start',g,oid=op))
check(results[0]==results[1] and results[0].get('status')=='in_progress','duplicate simultaneous prepare is idempotent')
g=results[0];op=str(uuid.uuid4());scores={'source':'watch','scoreA':11,'scoreB':0,'assignmentRevision':g['assignment_revision']}
results=parallel(lambda:mutate(scorer,'submit',g,scores,op),lambda:mutate(scorer,'submit',g,scores,op))
check(results[0]==results[1] and results[0].get('status')=='pending','duplicate simultaneous Watch upload commits once')
g=mutate(0,'confirm',results[0]);check(g.get('status')=='confirmed','concurrent upload result can be confirmed')
result=mutate(3,'submit',g,scores,op);check('already used' in result.get('error',''),'different account cannot replay an operation')
rpc(0,'play_session_cancel',{'p_session_id':sid})
print(f'PASS: {checks} live concurrency assertions. Session {sid}')
