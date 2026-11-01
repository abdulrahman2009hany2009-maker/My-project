const crypto=require("crypto");
const PID=process.env.FB_PROJECT_ID||"salahapp-5015d",KEY=process.env.FB_API_KEY||"AIzaSyCa_uyAE5_zp5TEfmIuhi3O7-Z7GdUl8rI";
const FS=`https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents/`;
let tok=null,exp=0;const last={};
const b64=o=>Buffer.from(typeof o=="string"?o:JSON.stringify(o)).toString("base64url");
async function access(){
 if(tok&&Date.now()<exp)return tok;
 const now=Math.floor(Date.now()/1000),em=process.env.FB_CLIENT_EMAIL,pk=(process.env.FB_PRIVATE_KEY||"").replace(/\\n/g,"\n");
 const u=b64({alg:"RS256",typ:"JWT"})+"."+b64({iss:em,scope:"https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600});
 const sig=crypto.createSign("RSA-SHA256").update(u).sign(pk,"base64url");
 const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion="+u+"."+sig});
 const j=await r.json();if(!j.access_token)throw new Error("auth");
 tok=j.access_token;exp=Date.now()+3300e3;return tok;
}
const gdoc=async p=>{const r=await fetch(FS+p,{headers:{Authorization:"Bearer "+await access()}});return r.ok?(await r.json()).fields||{}:null};
const sv=f=>f&&f.stringValue;
async function send(to,title,body,tag){
 const d=await gdoc("tokens/"+to),t=d&&sv(d.t);if(!t)return;
 await fetch(`https://fcm.googleapis.com/v1/projects/${PID}/messages:send`,{method:"POST",headers:{Authorization:"Bearer "+await access(),"Content-Type":"application/json"},
  body:JSON.stringify({message:{token:t,data:{title,body,tag:tag||""},webpush:{headers:{Urgency:"high",TTL:"3600"}}}})}).catch(()=>{});
}
const R=(c,m)=>({statusCode:c,body:m||""});
exports.handler=async ev=>{
 if(ev.httpMethod!=="POST")return R(405);
 let o;try{o=JSON.parse(ev.body||"{}")}catch(e){return R(400)}
 if(!o.t||!/^[A-Za-z0-9]{10,40}$/.test(o.gid||"")||!["remind","post","interact"].includes(o.kind))return R(400);
 try{
  const v=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+KEY,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idToken:o.t})}).then(r=>r.json());
  const uid=v.users&&v.users[0]&&v.users[0].localId;if(!uid)return R(401);
  const g=await gdoc("groups/"+o.gid);if(!g)return R(404);
  const mb=((g.mb||{}).arrayValue||{}).values||[],ids=mb.map(sv);if(!ids.includes(uid))return R(403);
  const me=(((g.mem||{}).mapValue||{}).fields||{})[uid],nm=me&&me.mapValue&&sv(me.mapValue.fields.n)||"عضو";
  if(o.kind=="remind"){
   if(!ids.includes(o.to)||o.to===uid)return R(400);
   const k=uid+o.to;if(Date.now()-(last[k]||0)<36e5)return R(429);last[k]=Date.now();
   await send(o.to,"تذكير من "+nm,"لا تنسَ تسجيل صلاتك في التطبيق 🌿",/^[A-Za-z0-9]{10,40}$/.test(o.nid||"")?o.nid:"");
  }else if(o.kind=="interact"){
   if(!ids.includes(o.to)||o.to===uid)return R(400);
   const k="i"+uid+o.to;if(Date.now()-(last[k]||0)<15e3)return R(429);last[k]=Date.now();
   await send(o.to,nm+(o.k=="comment"?" علّق على منشورك":" تفاعل مع منشورك"),String(o.b||"").slice(0,80),/^[A-Za-z0-9]{10,40}$/.test(o.nid||"")?o.nid:"");
  }else{
   const d=parseInt(o.d)||1,gn=sv(g.n)||"المجموعة";
   await Promise.all(ids.filter(x=>x!==uid).map(x=>send(x,gn,nm+" نشر #day "+d)));
  }
  return R(200,"ok");
 }catch(e){return R(500)}
};
