import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,verify} from 'node:crypto';
import {makeAppleSecret} from '../../scripts/auth/repair-apple-client-secret.mjs';

test('Apple client secret has correct web claims, bounded lifetime and a valid JOSE ES256 signature',()=>{
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const key=pair.privateKey.export({type:'pkcs8',format:'pem'});
  const now=1793556000;
  const token=makeAppleSecret(key,now);
  const [header,payload,signature]=token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header,'base64url').toString()),{alg:'ES256',kid:'8MM4XQSN7L'});
  const claims=JSON.parse(Buffer.from(payload,'base64url').toString());
  assert.deepEqual(claims,{iss:'ZX88S3Q93L',iat:now,exp:now+15552000,aud:'https://appleid.apple.com',sub:'com.picktennt.web'});
  assert.ok(claims.exp-claims.iat<=15777000);
  assert.equal(Buffer.from(signature,'base64url').length,64);
  assert.equal(verify('sha256',Buffer.from(`${header}.${payload}`),{key:pair.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),true);
});

test('rejects the wrong key type and invalid signing times',()=>{
  const pair=generateKeyPairSync('ec',{namedCurve:'secp384r1'});
  assert.throws(()=>makeAppleSecret(pair.privateKey.export({type:'pkcs8',format:'pem'}),1793556000),/P-256/);
  const valid=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'});
  for(const now of [0,-1,NaN,1.5]) assert.throws(()=>makeAppleSecret(valid,now),/signing time/);
});
