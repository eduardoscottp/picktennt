import {createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

/** Generate only in the process that owns the private key; never log the returned token. */
export function makeAppleSecret(privateKey,now) {
  const key=createPrivateKey(privateKey);
  if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1') throw new Error('Expected an Apple P-256 private key.');
  if(!Number.isSafeInteger(now)||now<=0) throw new Error('Invalid signing time.');
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const header=encode({alg:'ES256',kid:'8MM4XQSN7L'});
  const payload=encode({iss:'ZX88S3Q93L',iat:now,exp:now+15552000,aud:'https://appleid.apple.com',sub:'com.picktennt.web'});
  const input=`${header}.${payload}`;
  const signature=sign('sha256',Buffer.from(input),{key,dsaEncoding:'ieee-p1363'});
  if(signature.length!==64||!verify('sha256',Buffer.from(input),{key:createPublicKey(key),dsaEncoding:'ieee-p1363'},signature)) throw new Error('Signature verification failed.');
  return `${input}.${signature.toString('base64url')}`;
}

async function main() {
  if(process.platform!=='darwin') throw new Error('Run this on the Mac holding the private key.');
  if(process.argv.length>3) throw new Error('Usage: node repair-apple-client-secret.mjs [private-key-path]');
  const keyPath=process.argv[2]??path.join(homedir(),'Downloads','AuthKey_8MM4XQSN7L.p8');
  // Use Apple's HTTPS server time rather than a potentially incorrect workstation clock.
  const response=await fetch('https://appleid.apple.com/auth/keys');
  if(!response.ok) throw new Error('Could not obtain Apple server time.');
  const date=Date.parse(response.headers.get('date')??'');
  const age=Number(response.headers.get('age')??'0');
  if(!Number.isFinite(date)||!Number.isFinite(age)||age<0) throw new Error('Apple server time is unavailable.');
  const token=makeAppleSecret(readFileSync(keyPath),Math.floor(date/1000)+age);
  const copied=spawnSync('pbcopy',[],{input:token,encoding:'utf8',stdio:['pipe','pipe','pipe']});
  if(copied.status!==0) throw new Error('Could not copy the credential to the Mac clipboard.');
  console.log('Fresh Apple web JWT signed and verified; copied to the Mac clipboard.');
  console.log('Paste only into Supabase > Authentication > Providers > Apple > Secret Key, then Save.');
  console.log('Keep Client IDs: com.picktennt.web,Idddeas.Picktennt');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(()=>{console.error('Repair could not finish. Check the key path, P-256 key type, network and Mac clipboard. No token was printed.');process.exitCode=1;});
}
