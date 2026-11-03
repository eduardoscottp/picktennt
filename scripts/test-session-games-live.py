"""Explicit opt-in: tests only four provisioned QA accounts against their live backend.
Run: python3 scripts/test-session-games-live.py /path/to/private-qa-accounts.json
Credentials are never logged. Creates an isolated QA session and retains its audit trail.
"""
import json, sys, uuid, urllib.request, urllib.error, datetime
accounts = json.load(open(sys.argv[1]))
assert len(accounts) == 4 and all(a['email'].startswith('session-games-qa-') and a['email'].endswith('@example.com') for a in accounts)
checks = 0

def call(user, path, data=None, method=None):
    a = accounts[user]
    req = urllib.request.Request(a['url']+'/rest/v1/'+path, data=None if data is None else json.dumps(data).encode(), headers={'apikey':a['apikey'],'Authorization':'Bearer '+a['access_token'],'Content-Type':'application/json','Prefer':'return=representation'}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            body=response.read(); return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode()) from None

def rpc(user, name, data): return call(user,'rpc/'+name,data)
def check(condition, label):
    global checks
    assert condition, label
    checks += 1
    print('PASS:',label,flush=True)
def denied(fn, message):
    try: fn()
    except RuntimeError as e: check(message.lower() in str(e).lower(),message); return
    raise AssertionError('Expected rejection: '+message)
def mutate(user,op,g,data=None,oid=None):
    return rpc(user,'session_game_mutate',{'p_operation':op,'p_game_id':g['id'],'p_revision':g.get('revision'),'p_operation_id':oid or str(uuid.uuid4()),'p_data':data or {}})

sid=rpc(0,'play_session_create',{'p_title':'Live QA boundary '+str(uuid.uuid4())[:6],'p_starts_at':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=2)).isoformat(),'p_duration_minutes':90,'p_timezone':'America/New_York','p_court_count':1,'p_location_name':'QA Courts','p_location_address':'Test fixture','p_max_players':4,'p_format':'by_partner','p_description':'Automated release verification; QA accounts only.','p_creator_is_playing':False})
pairs=call(0,'play_session_pairs?session_id=eq.'+sid+'&order=pair_number')
def join(i,p,seat): return rpc(i,'play_session_join',{'p_session_id':sid,'p_pair_id':pairs[p]['id'],'p_seat_number':seat})
join(0,0,1)
denied(lambda:join(1,0,1),'SEAT_TAKEN')
join(1,0,2);join(2,1,1)
# Fourth account has no session relationship yet; verifies genuine outside visibility.
check(call(3,'play_session_games?session_id=eq.'+sid)==[],'outsider cannot read shared games')
denied(lambda:rpc(3,'play_session_detail',{'p_session_id':sid}),'SESSION_NOT_FOUND')
join(3,1,2)
detail=rpc(0,'play_session_detail',{'p_session_id':sid})
check(len(detail['members'])==4,'four real accounts on roster')
check(all(set(m['profile'])=={'id','first_name','last_name','avatar_url'} for m in detail['members']),'public roster excludes private profile fields')
ids=[a['id'] for a in accounts]
data={'sessionId':sid,'playerIds':ids,'matchType':'DOUBLES','scoringSystem':'SIDE_OUT','targetScore':11,'winByTwo':True,'courtNumber':1,'scorerId':ids[1]}
gid={'id':str(uuid.uuid4())}; oid=str(uuid.uuid4())
g=mutate(0,'create',gid,data,oid)
check(mutate(0,'create',gid,data,oid)==g,'duplicate create returns same result')
denied(lambda:mutate(1,'create',gid,data,oid),'already used')
denied(lambda:mutate(0,'accept',g),'invitation')
denied(lambda:mutate(0,'create',{'id':str(uuid.uuid4())},{**data,'playerIds':[ids[0]]*4}),'distinct')
denied(lambda:mutate(0,'create',{'id':str(uuid.uuid4())},{**data,'courtNumber':2}),'court')
denied(lambda:mutate(0,'create',{'id':str(uuid.uuid4())},{**data,'heartRate':110}),'Private health')
# Supabase may grant UPDATE, but row-level security must still prevent writes.
try:
    result=call(1,'play_session_games?id=eq.'+g['id'],{'status':'confirmed'},'PATCH')
    check(result==[],'direct writes cannot bypass mutation RPC')
except RuntimeError as e: check('permission' in str(e).lower(),'direct writes denied')
g=mutate(1,'decline',g);check(g['status']=='unassigned','decline releases scorer')
g=mutate(0,'assign',g,{'scorerId':ids[2]}); stale=g.copy()
denied(lambda:mutate(1,'accept',g),'invitation')
g=mutate(2,'accept',g);check(g['status']=='ready','new scorer explicitly accepts')
denied(lambda:mutate(2,'accept',stale),'changed')
denied(lambda:mutate(0,'assign',g,{'scorerId':ids[1]}),'reassign')
g=mutate(2,'start',g)
denied(lambda:mutate(0,'submit',g,{'source':'manual','scoreA':11,'scoreB':4}),'Watch is scoring')
denied(lambda:mutate(2,'submit',g,{'source':'watch','scoreA':11,'scoreB':4,'assignmentRevision':0}),'assignment')
prepared=g.copy();result={'source':'watch','scoreA':4,'scoreB':11,'assignmentRevision':g['assignment_revision']}; operation=str(uuid.uuid4())
g=mutate(2,'submit',g,result,operation)
check(mutate(2,'submit',prepared,result,operation)==g,'duplicate Watch submission is idempotent')
denied(lambda:mutate(3,'confirm',g),'opponent')
g=mutate(1,'dispute',g);check(g['status']=='disputed','participant disputes pending score')
denied(lambda:mutate(1,'confirm',g),'opponent')
g=mutate(0,'confirm',g);check(g['status']=='confirmed','organizer explicitly resolves dispute')
for i in range(4): check(call(i,'play_session_games?id=eq.'+g['id'])[0]['status']=='confirmed','confirmed result visible to participant '+str(i+1))
denied(lambda:mutate(1,'submit',g,{'source':'manual','scoreA':11,'scoreB':7}),'organizer')
g=mutate(0,'submit',g,{'source':'manual','scoreA':11,'scoreB':8});check(g['status']=='pending','correction requires confirmation again')
g=mutate(2,'confirm',g)
rpc(0,'play_session_remove_member',{'p_session_id':sid,'p_user_id':ids[3]})
check(call(3,'play_session_games?id=eq.'+g['id'])[0]['participants']==g['participants'],'departed player retains historical attribution')
denied(lambda:join(3,1,2),'REJOIN_BLOCKED')
denied(lambda:mutate(0,'create',{'id':str(uuid.uuid4())},data),'roster changed')
rpc(0,'play_session_allow_rejoin',{'p_session_id':sid,'p_user_id':ids[3]});join(3,1,2)
changed=mutate(0,'create',{'id':str(uuid.uuid4())},{**data,'playerIds':[ids[0],ids[2],ids[1],ids[3]],'scorerId':None})
check([p['userId'] for p in changed['participants'] if p['team']==0]==[ids[0],ids[2]],'per-game partners may change')
check(rpc(0,'play_session_detail',{'p_session_id':sid})['members'][0]['pair_id']==pairs[0]['id'],'game partners preserve session registration')
for a,b in [(-1,11),(11,11),(10,8),(11,10),(14,10),(10001,0)]:
    denied(lambda:mutate(0,'submit',changed,{'source':'manual','scoreA':a,'scoreB':b}),'score')
changed=mutate(0,'submit',changed,{'source':'manual','scoreA':12,'scoreB':10});check(changed['status']=='pending','valid win-by-two overtime accepted')
singles=mutate(1,'create',{'id':str(uuid.uuid4())},{**data,'playerIds':[ids[1],ids[3]],'matchType':'SINGLES','scoringSystem':'RALLY','winByTwo':False,'scorerId':None})
singles=mutate(1,'submit',singles,{'source':'manual','scoreA':11,'scoreB':10});singles=mutate(3,'confirm',singles);check(singles['status']=='confirmed','singles rally win-by-one confirmed by opponent')
unfinished=mutate(0,'create',{'id':str(uuid.uuid4())},data);unfinished=mutate(1,'accept',unfinished);unfinished=mutate(1,'start',unfinished);unfinished=mutate(1,'submit',unfinished,{'source':'watch','scoreA':2,'scoreB':1,'assignmentRevision':unfinished['assignment_revision'],'unfinished':True})
check(unfinished['status']=='unfinished','unfinished games excluded from confirmed results')
denied(lambda:mutate(0,'confirm',unfinished),'opponent')
audit=call(1,'play_session_game_operations?game_id=eq.'+g['id']);check(len(audit)>=9,'audit trail retained')
rpc(0,'play_session_cancel',{'p_session_id':sid})
denied(lambda:mutate(0,'create',{'id':str(uuid.uuid4())},data),'unavailable')
print(f'PASS: {checks} live backend assertions across four real QA accounts. Session {sid}')
