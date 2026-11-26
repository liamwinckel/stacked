// Minimal Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) for Workers / any WebCrypto runtime
const te=new TextEncoder();
export const b64u={
  enc:b=>{let s='';const a=new Uint8Array(b);for(let i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')},
  dec:s=>{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const b=atob(s),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a}};
const cat=(...as)=>{const n=as.reduce((t,a)=>t+a.length,0),o=new Uint8Array(n);let p=0;for(const a of as){o.set(a,p);p+=a.length}return o};
async function hkdf(salt,ikm,info,len){const k=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},k,len*8))}
export async function encrypt(payload,p256dh,auth,opts={}){
  const ua=b64u.dec(p256dh),authS=b64u.dec(auth);
  const eph=opts.ephemeral||await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const asPub=new Uint8Array(await crypto.subtle.exportKey('raw',eph.publicKey));
  const uaKey=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:uaKey},eph.privateKey,256));
  const ikm=await hkdf(authS,shared,cat(te.encode('WebPush: info\0'),ua,asPub),32);
  const salt=opts.salt||crypto.getRandomValues(new Uint8Array(16));
  const cek=await hkdf(salt,ikm,te.encode('Content-Encoding: aes128gcm\0'),16);
  const nonce=await hkdf(salt,ikm,te.encode('Content-Encoding: nonce\0'),12);
  const key=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,cat(typeof payload==='string'?te.encode(payload):payload,new Uint8Array([2]))));
  const rs=new Uint8Array([0,0,16,0]);
  return cat(salt,rs,new Uint8Array([asPub.length]),asPub,ct)}
export async function vapidAuth(endpoint,pubB64,privB64,sub){
  const pub=b64u.dec(pubB64);
  const jwk={kty:'EC',crv:'P-256',d:privB64,x:b64u.enc(pub.slice(1,33)),y:b64u.enc(pub.slice(33,65)),ext:true};
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const aud=new URL(endpoint).origin,h=b64u.enc(te.encode(JSON.stringify({typ:'JWT',alg:'ES256'}))),p=b64u.enc(te.encode(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+12*3600,sub})));
  const sig=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,te.encode(h+'.'+p)));
  return `vapid t=${h}.${p}.${b64u.enc(sig)}, k=${pubB64}`}
export async function sendPush(sub,payload,env){
  const body=await encrypt(payload,sub.keys.p256dh,sub.keys.auth);
  return fetch(sub.endpoint,{method:'POST',headers:{'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',TTL:'120',Urgency:'high',Authorization:await vapidAuth(sub.endpoint,env.VAPID_PUBLIC,env.VAPID_PRIVATE_KEY,env.VAPID_SUB)},body})}
