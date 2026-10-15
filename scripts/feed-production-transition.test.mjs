import test from 'node:test';
import assert from 'node:assert/strict';
import { readTransitionResponse, transitionActors } from './feed-production-transition.mjs';
const identity = {sourceSha:'a'.repeat(40),imageBuildId:'b'.repeat(64),mode:'baseline',writerEpoch:1};
const anchor = {status:'passed',mode:'paused',sourceSha:identity.sourceSha,backend:'go',store:'cf_d1_r2',workerVersionId:'12345678-1234-4234-8234-123456789abc'};
test('fixed actor transitions are sequential and recheck paused Web through final readback',async()=>{
 const calls=[],states=[];
 const result=await transitionActors(identity,{paused:async()=>{calls.push('paused');return anchor;},send:async(target,body)=>{calls.push(target);return {restarted:true,target,...body};},record:e=>states.push(JSON.parse(JSON.stringify(e)))});
 assert.deepEqual(calls,['paused','api-0','paused','api-1','paused','executor-0','paused']);assert.equal(result.status,'passed');
 assert.equal(states[1].targets[0].status,'attempted_unverified');assert.equal(states.at(-1).targets.length,3);
});
test('changed or unpaused Web prevents the next mutation, including changes after final actor',async()=>{
 for(const changeAt of [1,2,4]){let reads=0,sends=0;await assert.rejects(transitionActors(identity,{paused:async()=>++reads===changeAt?{...anchor,workerVersionId:'12345678-1234-4234-8234-123456789def',mode:changeAt===1?'all':'paused'}:anchor,send:async(target,body)=>{sends++;return {restarted:true,target,...body};}}));assert.equal(sends,changeAt-1);}
});
test('lost acknowledgements are recorded as failed and never replayed blindly',async()=>{
 let sends=0,final;await assert.rejects(transitionActors(identity,{paused:async()=>anchor,send:async()=>{sends++;throw Error('lost reply');},record:e=>final=JSON.parse(JSON.stringify(e))}),/lost reply/);assert.equal(sends,1);assert.equal(final.status,'failed');assert.equal(final.targets[0].status,'attempted_unverified');
});
test('wrong identity, targets, extra fields or an incomplete restart cannot advance',async()=>{
 for(const patch of [{sourceSha:'c'.repeat(40)},{imageBuildId:'c'.repeat(64)},{target:'api-1'},{mode:'off'},{writerEpoch:2},{restarted:false},{extra:'untrusted'}]){let sends=0;await assert.rejects(transitionActors(identity,{paused:async()=>anchor,send:async(target,body)=>{sends++;return {restarted:true,target,...body,...patch};}}));assert.equal(sends,1);}
});

import { edgePreflight, configurationLimits } from './feed-production-transition.mjs';
const offVersion='12345678-1234-4234-8234-123456789001', baselineVersion='12345678-1234-4234-8234-123456789002';
const off={runtime:{versionId:offVersion},image:'image@sha256:exact'};
const configuration=(mode='baseline')=>({service:'feed-runtime',version:identity.sourceSha,contractVersion:'1',workerVersionId:mode==='off'?offVersion:baselineVersion,configuredImage:off.image,imageBuildId:identity.imageBuildId,mode,writerEpoch:1});
test('known off propagates to exact baseline before each mutation',async()=>{
 let reads=0,clock=0;const observations=[];
 const preflight=edgePreflight(identity,off,{now:()=>clock,sleep:async ms=>{clock+=ms;},read:async()=>configuration(++reads===1?'off':'baseline')});
 const result=await transitionActors(identity,{paused:async()=>anchor,preflight,send:async(target,body)=>({restarted:true,target,...body}),record:e=>observations.push(JSON.parse(JSON.stringify(e)))});
 assert.equal(reads,4);assert.equal(clock,configurationLimits.intervalMs);assert.equal(result.status,'passed');assert.equal(result.edgePreflight[1].status,'known_off');
});
test('bounded stale off and invalid identities fail without mutation',async()=>{
 for(const patch of [null,{version:'c'.repeat(40)},{imageBuildId:'c'.repeat(64)},{configuredImage:'wrong'},{writerEpoch:2},{extra:true},{workerVersionId:baselineVersion,mode:'off'}]){
 let reads=0,sends=0,clock=0;
 const preflight=edgePreflight(identity,off,{now:()=>clock,sleep:async ms=>{clock+=ms;},read:async()=>{reads++;return patch?{...configuration(),...patch}:configuration('off');}});
 await assert.rejects(transitionActors(identity,{paused:async()=>anchor,preflight,send:async()=>{sends++;}}));
 assert.equal(sends,0);assert.equal(reads,patch?1:36);assert.ok(clock<configurationLimits.durationMs);
 }
});
test('only explicit pre-dispatch rejection repeats preflight and preserves unknown outcomes',async()=>{
 for(const kind of ['rejected','transport','exhausted']){
 let reads=0,sends=0;
 const preflight=edgePreflight(identity,off,{read:async()=>{reads++;return configuration();}});
 const work=transitionActors(identity,{paused:async()=>anchor,preflight,send:async(target,body)=>{sends++;if(kind==='transport')throw Error('lost');if(kind==='exhausted'||sends===1)return {rejectedWithoutMutation:true};return {restarted:true,target,...body};}});
 if(kind==='rejected'){const result=await work;assert.equal(result.targets[0].rejectedWithoutMutation,1);assert.equal(sends,4);assert.equal(reads,4);}
 else {await assert.rejects(work);assert.equal(sends,kind==='transport'?1:3);}
 }
});
test('read transport error and overall deadline cannot reach restart',async()=>{
 for(const slow of [false,true]){let clock=0,sends=0;
 const preflight=edgePreflight(identity,off,{now:()=>clock,read:async()=>{if(!slow)throw Error('network');clock=configurationLimits.durationMs;return configuration();}});
 await assert.rejects(transitionActors(identity,{paused:async()=>anchor,preflight,send:async()=>{sends++;}}));assert.equal(sends,0);
 }
});

import { validatePreDispatchRejection } from './feed-production-transition.mjs';
test('rejection whitelist permits only known off version and exact pre-dispatch error',()=>{
 const valid={error:'transition_environment_not_ready',workerVersionId:offVersion};
 assert.doesNotThrow(()=>validatePreDispatchRejection(valid,offVersion));
 for(const value of [null,{}, {...valid,error:'transition_in_progress'},{...valid,workerVersionId:baselineVersion},{...valid,extra:true}])
 assert.throws(()=>validatePreDispatchRejection(value,offVersion));
});

test('successful lifecycle time between probes does not spend cumulative preflight allowance',async()=>{
 let clock=1000,reads=0;
 const preflight=edgePreflight(identity,off,{now:()=>clock,read:async()=>{reads++;clock+=100;return configuration();}});
 await preflight(()=>{});clock+=90000;await preflight(()=>{});clock+=90000;await preflight(()=>{});
 assert.equal(reads,3);
});
test('preflight wall time accumulates across calls and never gains a fresh allowance',async()=>{
 let clock=1000,reads=0;
 const preflight=edgePreflight(identity,off,{now:()=>clock,sleep:async ms=>{clock+=ms;},read:async()=>{reads++;clock+=configurationLimits.durationMs/3;return configuration(reads===2?'off':'baseline');}});
 await preflight(()=>{});clock+=90000;
 await assert.rejects(preflight(()=>{}),/deadline exceeded/);
 assert.equal(reads,3);
 await assert.rejects(preflight(()=>{}),/exhausted/);
 assert.equal(reads,3);
});

import { rejectionCode } from './feed-production-transition.mjs';
test('a rejected transition names only the runtime error code', async () => {
  const reply = (body) => new Response(body, { status: 503 });
  assert.equal(await rejectionCode(reply('{"error":"container_not_ready"}')), 'container_not_ready');
  assert.equal(await rejectionCode(reply('{"error":"Bearer secret value"}')), 'unrecognized_error_body');
  assert.equal(await rejectionCode(reply('<html>bad gateway</html>')), 'unreadable_error_body');
  assert.equal(await rejectionCode(reply('x'.repeat(4096))), 'unreadable_error_body');
});

test('HTTP 200 restart receipts are read once and reach every release identity check', async () => {
  const responses = [], calls = [];
  const result = await transitionActors(identity, {
    paused: async () => anchor,
    send: async (target, body) => {
      calls.push(target);
      const response = Response.json({ restarted: true, target, ...body });
      responses.push(response);
      return readTransitionResponse(response, target, offVersion);
    },
  });
  assert.equal(result.status, 'passed');
  assert.deepEqual(calls, ['api-0', 'api-1', 'executor-0']);
  assert.ok(responses.every(response => response.bodyUsed));
});

test('HTTP success does not bypass exact receipt identity or permit replay after malformed replies', async () => {
  for (const body of [
    { rejectedWithoutMutation: true },
    { restarted: true, target: 'api-0', ...identity, sourceSha: 'c'.repeat(40) },
    { restarted: true, target: 'api-0', ...identity, extra: true },
    { kind: 'http-error', code: 'invalid_transition', status: 400 },
    'invalid JSON', 'x'.repeat(4096),
  ]) {
    let calls = 0;
    await assert.rejects(transitionActors(identity, {
      paused: async () => anchor,
      preflight: async () => {},
      send: async target => {
        calls++;
        const response = typeof body === 'string' ? new Response(body) : Response.json(body);
        return readTransitionResponse(response, target, offVersion);
      },
    }));
    assert.equal(calls, 1);
  }
});

test('HTTP failures expose only bounded error codes and never retry an unknown mutation outcome', async () => {
  for (const [status, body, message] of [
    [400, { error: 'invalid_transition' }, /400; api-0; invalid_transition/],
    [503, { error: 'transition_timeout' }, /503; api-0; transition_timeout/],
    [503, { error: 'private provider message' }, /503; api-0; unrecognized_error_body/],
    [409, { error: 'transition_in_progress' }, /unproven transition rejection/],
    [409, { error: 'transition_environment_not_ready', workerVersionId: baselineVersion }, /unproven transition rejection/],
    [409, { error: 'transition_environment_not_ready', workerVersionId: offVersion, extra: true }, /unproven transition rejection/],
  ]) {
    let calls = 0;
    await assert.rejects(transitionActors(identity, {
      paused: async () => anchor,
      preflight: async () => {},
      send: async target => {
        calls++;
        return readTransitionResponse(Response.json(body, { status }), target, offVersion);
      },
    }), message);
    assert.equal(calls, 1);
  }
});

test('only a proven HTTP 409 from the known off edge can repeat preflight', async () => {
  let calls = 0, preflights = 0;
  const result = await transitionActors(identity, {
    paused: async () => anchor,
    preflight: async () => { preflights++; },
    send: async (target, body) => {
      const response = ++calls === 1
        ? Response.json({ error: 'transition_environment_not_ready', workerVersionId: offVersion }, { status: 409 })
        : Response.json({ restarted: true, target, ...body });
      return readTransitionResponse(response, target, offVersion);
    },
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.targets[0].rejectedWithoutMutation, 1);
  assert.equal(calls, 4);
  assert.equal(preflights, 4);
});

const actorIds = new Map(['api-0','api-1','executor-0'].map((target, index) => [target, String(index + 1).repeat(64)]));
const nativeOff = { ...off, readiness: [...actorIds].map(([target, actorId]) => ({ target, actorId })) };
const actorConfiguration = (target, mode = 'baseline') => ({
 target, actorId: actorIds.get(target), workerVersionId: mode === 'off' ? offVersion : baselineVersion,
 sourceSha: identity.sourceSha, configuredImage: off.image, imageBuildId: identity.imageBuildId, mode, writerEpoch: 1,
});
test('all three DO environments converge before first lifecycle mutation; each later actor is rechecked', async () => {
 let clock=0, actorReads=0;
 const seen=[], calls=[];
 const preflight=edgePreflight(identity,nativeOff,{
  now:()=>clock,sleep:async ms=>{clock+=ms;},read:async()=>configuration(),
  readActor:async target=>{actorReads++;calls.push(`read:${target}`);seen.push(target);return actorConfiguration(target,actorReads===1?'off':'baseline');},
 });
 await transitionActors(identity,{paused:async()=>anchor,preflight,send:async(target,body)=>{
  assert.deepEqual([...new Set(seen)],['api-0','api-1','executor-0']);calls.push(`post:${target}`);clock+=30000;return {restarted:true,target,...body};
 }});
 assert.deepEqual(calls,['read:api-0','read:api-0','read:api-1','read:executor-0','post:api-0','read:api-1','post:api-1','read:executor-0','post:executor-0']);
 assert.equal(clock,90000+configurationLimits.intervalMs);
});
test('foreign, malformed or unavailable DO configuration never grants a first lifecycle POST', async () => {
 for(const patch of [null,{}, {actorId:'f'.repeat(64)},{target:'api-1'}, {sourceSha:'c'.repeat(40)},
  {imageBuildId:'c'.repeat(64)},{configuredImage:'other'}, {writerEpoch:2}, {mode:'baseline',workerVersionId:offVersion},
  {mode:'off',workerVersionId:baselineVersion},{workerVersionId:'12345678-1234-4234-8234-123456789099'},{extra:true},'missing method']) {
  let sends=0,reads=0;
  const preflight=edgePreflight(identity,nativeOff,{read:async()=>configuration(),readActor:async target=>{
   reads++;if(patch==='missing method')throw Error('runtime configuration preflight rejected (503)');
   return patch===null?null:Object.keys(patch).length?{...actorConfiguration(target),...patch}:{};
  }});
  await assert.rejects(transitionActors(identity,{paused:async()=>anchor,preflight,send:async()=>{sends++;}}));
  assert.equal(sends,0);assert.equal(reads,1);
 }
});
test('edge and all actor reads share time and request budgets before first mutation', async () => {
 let clock=0,reads=0,sends=0;
 const preflight=edgePreflight(identity,nativeOff,{now:()=>clock,sleep:async ms=>{clock+=ms;},
  read:async()=>{reads++;clock+=120000;return configuration();},
  readActor:async target=>{reads++;clock+=30000;return actorConfiguration(target,'off');},
 });
 await assert.rejects(transitionActors(identity,{paused:async()=>anchor,preflight,send:async()=>{sends++;}}),/deadline exceeded/);
 assert.equal(reads,3);assert.equal(sends,0);
 await assert.rejects(preflight(()=>{}),/exhausted/);assert.equal(reads,3);
 let gets=0;
 const capped=edgePreflight(identity,nativeOff,{now:()=>0,sleep:async()=>{},read:async()=>{gets++;return configuration();},
  readActor:async target=>{gets++;return actorConfiguration(target,'off');},
 });
 await assert.rejects(capped(()=>{}),/exhausted/);assert.equal(gets,configurationLimits.reads);
});
test('configuration proof does not authorize replay if a POST races propagation or loses its reply', async () => {
 for(const response of [Response.json({error:'invalid_transition'},{status:400}),null]) {
  let sends=0;
  const preflight=edgePreflight(identity,nativeOff,{read:async()=>configuration(),readActor:async target=>actorConfiguration(target)});
  await assert.rejects(transitionActors(identity,{paused:async()=>anchor,preflight,send:async target=>{
   sends++;if(!response)throw Error('lost reply');return readTransitionResponse(response,target,offVersion);
  }}));assert.equal(sends,1);
 }
});


test('exact known-off DO may converge after 90 seconds without any lifecycle call before all actors match',async()=>{
 let clock=0,sends=0,gets=0;
 const seen=new Set();
 const preflight=edgePreflight(identity,nativeOff,{now:()=>clock,sleep:async ms=>{clock+=ms;},
  read:async()=>{gets++;return configuration();},readActor:async target=>{gets++;const mode=clock<90000?'off':'baseline';if(mode==='baseline')seen.add(target);return actorConfiguration(target,mode);}});
 const result=await transitionActors(identity,{paused:async()=>anchor,preflight,send:async(target,body)=>{
  assert.equal(clock,90000);assert.equal(seen.size,3);sends++;return {restarted:true,target,...body};}});
 assert.equal(result.status,'passed');assert.equal(sends,3);assert.ok(gets<configurationLimits.reads);
 assert.ok(result.edgePreflight.some(o=>o.elapsedMs===90000&&o.scope==='actor'&&o.status==='baseline_verified'));
 assert.ok(result.edgePreflight.every(o=>o.elapsedMs<=configurationLimits.durationMs));
});
test('slow actors share one three-minute allowance rather than each receiving a new window',async()=>{
 let clock=0,sends=0,gets=0;
 const preflight=edgePreflight(identity,nativeOff,{now:()=>clock,sleep:async ms=>{clock+=ms;},
  read:async()=>{gets++;return configuration();},readActor:async target=>{gets++;return actorConfiguration(target,
   clock>=({'api-0':90000,'api-1':190000,'executor-0':190000}[target])?'baseline':'off');}});
 await assert.rejects(transitionActors(identity,{paused:async()=>anchor,preflight,send:async()=>{sends++;}}),/exhausted/);
 assert.equal(sends,0);assert.ok(clock<configurationLimits.durationMs);assert.ok(gets<configurationLimits.reads);
});
