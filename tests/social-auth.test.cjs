const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { createHash, randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const path = require('node:path');

test('Google staging: first/repeat login, explicit linking, browser binding, replay and session revocation', async t => {
  const express = require('../backend/node_modules/express');
  const { createSocialAuthRouter } = await import('../backend/routes/social-auth.js');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(path.join(__dirname, '../backend/db/schema.sql'), 'utf8'));
  const hashPassword = (value, salt=randomBytes(16).toString('hex')) => ({salt,hash:scryptSync(value,salt,64).toString('hex')});
  const verifyPassword = (value,salt,hash) => timingSafeEqual(Buffer.from(hashPassword(value,salt).hash,'hex'),Buffer.from(hash,'hex'));
  const pass=hashPassword('current-password');
  db.prepare('INSERT INTO users(id,login,email,pass_hash,pass_salt,email_verified) VALUES(1,?,?,?,?,1)').run('existing','existing@example.org',pass.hash,pass.salt);
  db.prepare('INSERT INTO users(id,login,email,pass_hash,pass_salt,email_verified) VALUES(2,?,?,?,?,1)').run('other','other@example.org',pass.hash,pass.salt);
  const createSession = user => { const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token,user,Date.now()+3600000);return token; };
  let existingSession=createSession(1), otherSession=createSession(2), cfg, nextIdentity, exchanged=0, hook;
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{
    req.token=(req.headers.authorization||'').replace('Bearer ','');
    req.userId=db.prepare('SELECT user_id FROM sessions WHERE token=? AND expires_at>?').get(req.token,Date.now())?.user_id;
    next();
  });
  const makeRouter=()=>createSocialAuthRouter({db,hashPassword,verifyPassword,createSession,publicUser:u=>({id:u.id,email:u.email}),
    config:()=>cfg, exchange:async(code,flow,config)=>{ exchanged++;assert.equal(code,'synthetic-code');assert.equal(flow.verifier.length,43);assert.equal(config.clientId,'client');if(hook)hook();return nextIdentity; }});
  // Replacing the router simulates a process reload with persistent DB state.
  let router=makeRouter();app.use('/api/auth/oauth',(req,res,next)=>router(req,res,next));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  cfg={origin,clientId:'client',clientSecret:'synthetic-secret',redirectUri:origin+'/api/auth/oauth/google/callback'};
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const request=async(route,{body,cookie='',token='',source=origin}={})=>{
    const r=await fetch(origin+'/api/auth/oauth'+route,{method:body===undefined?'GET':'POST',redirect:'manual',
      headers:{'Content-Type':'application/json','X-Disbit-OAuth':'1',Origin:source,Cookie:cookie,Authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}
    return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0],location:r.headers.get('location'),cache:r.headers.get('cache-control')};
  };
  const start=async(mode='login',token='',extra={})=>{
    const r=await request('/google/start',{body:{mode,password:'current-password'},token,...extra});
    if(r.status===200){r.url=new URL(r.data.url);r.state=r.url.searchParams.get('state');}return r;
  };
  const callback=(flow,extra='')=>request('/google/callback?code=synthetic-code&state='+flow.state+extra,{cookie:flow.cookie});
  const finish=(flow,token='')=>request('/google/result',{body:{},cookie:flow.cookie,token});
  const successfulLogin=async(identity)=>{nextIdentity=identity;const f=await start();assert.equal((await callback(f)).status,303);return finish(f);};

  assert.equal((await start('login','',{source:'https://attacker.invalid'})).status,403);
  assert.equal((await start('link')).status,401);
  const badPassword=await request('/google/start',{body:{mode:'link',password:'wrong'},token:existingSession});assert.equal(badPassword.status,403);
  nextIdentity={subject:'subject-first',email:'new@example.org'};
  const first=await start();assert.equal(first.status,200);assert.equal(first.cache,'no-store');
  assert.equal(first.url.searchParams.get('code_challenge_method'),'S256');
  const flow=db.prepare('SELECT * FROM oauth_flows').get();
  assert.equal(first.url.searchParams.get('code_challenge'),createHash('sha256').update(flow.verifier).digest('base64url'));
  assert.notEqual(flow.state_hash,first.state);
  assert.equal((await callback({...first,cookie:''})).status,400);assert.equal(exchanged,0);
  router=makeRouter(); // State and browser binding survive process recreation.
  const returned=await callback(first);assert.equal(returned.location,origin+'/?oauth=google');
  assert(!returned.location.includes('token'));assert(!returned.location.includes('synthetic-code'));
  assert.equal((await callback(first)).status,400);assert.equal(exchanged,1);
  const loggedIn=await finish(first);assert.equal(loggedIn.data.result,'login');assert(loggedIn.data.token);
  assert.equal((await finish(first)).data.result,'expired');
  const repeat=await successfulLogin(nextIdentity);assert.equal(repeat.data.user.id,loggedIn.data.user.id);
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,3);

  const collision=await successfulLogin({subject:'existing-subject',email:'existing@example.org'});
  assert.equal(collision.data.result,'link_required');assert(!collision.data.token);
  nextIdentity={subject:'existing-subject',email:'existing@example.org'};
  const link=await start('link',existingSession);await callback(link);
  assert.equal((await finish(link,existingSession)).data.result,'linked');
  const linkedLogin=await successfulLogin(nextIdentity);assert.equal(linkedLogin.data.user.id,1);
  const stealing=await start('link',otherSession);await callback(stealing);
  assert.equal((await finish(stealing,otherSession)).data.result,'identity_in_use');

  const revoked=await start('link',existingSession);
  // Revocation while provider exchange is pending must prevent the link.
  hook=()=>db.prepare('DELETE FROM sessions WHERE token=?').run(existingSession);
  assert.equal((await callback(revoked)).status,303);hook=null;
  assert.equal((await finish(revoked)).data.result,'session_expired');
  existingSession=createSession(1);
  const beforeCallback=await start('link',existingSession);
  db.prepare('DELETE FROM sessions WHERE token=?').run(existingSession);
  assert.equal((await callback(beforeCallback)).status,400);

  const expired=await start();db.exec('UPDATE oauth_flows SET expires_at=0');assert.equal((await callback(expired)).status,400);
  const cancel=await start();
  assert.equal((await request('/google/callback?error=access_denied&state='+cancel.state,{cookie:cancel.cookie})).status,303);
  assert.equal((await finish(cancel)).data.result,'cancelled');
  const broken=await start();hook=()=>{throw Error('synthetic-secret')};await callback(broken);hook=null;
  assert.equal((await finish(broken)).data.result,'failed');
  for(let i=0;i<22;i++)await start();router=makeRouter();assert.equal((await start()).status,429);
  cfg=null;assert.equal((await request('/providers')).data.google,false);assert.equal((await start()).status,503);
});

test('Google ID tokens reject wrong signature, issuer, audience, nonce, expiry and unverified email', async()=>{
  const { verifyGoogleToken, googleConfig }=await import('../backend/lib/google-identity.js');
  const { SignJWT, generateKeyPair }=await import('../backend/node_modules/jose/dist/webapi/index.js');
  const keys=await generateKeyPair('RS256');const wrong=await generateKeyPair('RS256');
  const config={clientId:'our-client'};
  const claims={iss:'https://accounts.google.com',aud:'our-client',sub:'123',nonce:'expected-nonce',email:'Test@example.org',email_verified:true,
    iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300};
  const sign=(changes={},key=keys.privateKey)=>new SignJWT({...claims,...changes}).setProtectedHeader({alg:'RS256'}).sign(key);
  const check=async(changes,key)=>verifyGoogleToken(await sign(changes,key),config,'expected-nonce',keys.publicKey);
  assert.deepEqual(await check(),{subject:'123',email:'test@example.org'});
  for(const changes of [{iss:'https://evil.invalid'},{aud:'other-client'},{aud:['our-client','other-client']},{nonce:'wrong'},{email_verified:false},{exp:1},{azp:'other-client'},{sub:''},{iat:1}])await assert.rejects(()=>check(changes));
  await assert.rejects(()=>check({},wrong.privateKey));
  const env={GOOGLE_OAUTH_ENABLED:'1',APP_ENV:'test',PUBLIC_URL:'http://127.0.0.1:3470',GOOGLE_OAUTH_CLIENT_ID:'client',GOOGLE_OAUTH_CLIENT_SECRET:'secret'};
  assert.equal(googleConfig(env).redirectUri,'http://127.0.0.1:3470/api/auth/oauth/google/callback');
  for(const change of [{APP_ENV:'production'},{APP_ENV:'staging'},{PUBLIC_URL:'http://example.org'},{PUBLIC_URL:'https://example.org/extra'},{GOOGLE_OAUTH_ENABLED:'0'}])assert.equal(googleConfig({...env,...change}),null);
});
