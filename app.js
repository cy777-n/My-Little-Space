const db=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY),
$=x=>document.querySelector(x),$$=x=>[...document.querySelectorAll(x)],
esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
safeUrl=x=>{try{const u=new URL(String(x??""),location.href);return ["http:","https:"].includes(u.protocol)?u.href:""}catch{return""}};

const cats={
  food:["日式","韓式","義式","咖啡廳","餐酒館","其他"],
  wishlist:["台灣","日本","其他"],
  watchlist:["韓劇","陸劇","電影","其他"]
};
const ATTACH_BUCKET="attachments";
let view="home",cat=null,editing=null,rows=[],register=false,attachmentsByItem={},groups=[],selectedScope="private",selectedGroupId=null;

$("#switch").onclick=()=>{
  register=!register;
  $("#login button").textContent=register?"註冊":"登入";
  $("#switch").textContent=register?"已經有帳號？登入":"還沒有帳號？註冊";
  $("#hint").textContent=register?"建立帳號後就可以保存你的資料。":"登入後就可以保存你的資料。"
};
$("#login").onsubmit=async e=>{
  e.preventDefault();
  const email=$("#email").value.trim(),password=$("#pw").value;
  const r=register?await db.auth.signUp({email,password}):await db.auth.signInWithPassword({email,password});
  $("#msg").textContent=r.error?r.error.message:(register&&!r.data.session?"註冊成功，請驗證 Email 後登入。":"")
};
$("#logout").onclick=()=>db.auth.signOut();
$$('[data-view]').forEach(b=>b.onclick=()=>openView(b.dataset.view));
$("#back").onclick=home;
$("#add").onclick=chooser;
$("#add2").onclick=()=>openForm(view);
$("#close").onclick=close;

function home(){$("#home").classList.remove("hidden");$("#list").classList.add("hidden");view="home"}

function openView(v){
  view=v;
  selectedScope="private"; selectedGroupId=null;
  cat=v==="todo"?"提醒事項":v==="memo"?null:cats[v][0];
  $("#home").classList.add("hidden");
  $("#list").classList.remove("hidden");
  $("#title").textContent=v==="todo"?"生活管理":v==="food"?"食物":v==="wishlist"?"想買":v==="watchlist"?"影劇":"備忘錄";
  $("#share").classList.toggle("hidden", !(v==="todo"||v==="memo"));
  $("#share").textContent="👥 群組空間";
  renderCats();
  load()
}
function renderCats(){
  const list=view==="todo"?["提醒事項","行程"]:view==="memo"?[]:cats[view];
  $("#cats").innerHTML=list.map(c=>`<button class="${c===cat?"active":""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
  $$('[data-cat]').forEach(b=>b.onclick=()=>{cat=b.dataset.cat;renderCats();load()})
}
function filterColumn(){return view==="todo"?"event_type":view==="wishlist"?"country":"category"}

async function load(){
  const table=view==="todo"?"todos":view==="memo"?"memos":view;
  const {data:uData}=await db.auth.getUser(),u=uData.user;
  if(!u)return;
  await loadGroups();
  let q;
  if(view==="memo"||view==="todo") {
    if(selectedScope==="group" && selectedGroupId){
      q=db.from(table).select("*").eq("share_group_id",selectedGroupId);
    }else{
      q=db.from(table).select("*").eq("user_id",u.id).is("share_group_id",null);
    }
    if(view!=="memo")q=q.eq(filterColumn(),cat);
  } else {
    q=db.from(table).select("*").eq("user_id",u.id);
    if(view!=="memo")q=q.eq(filterColumn(),cat);
  }
  const r=await q.order("created_at",{ascending:false});
  if(r.error){console.error(r.error);$("#cards").innerHTML=`<p class="meta">${esc(r.error.message)}</p>`;return}
  rows=r.data||[];
  attachmentsByItem={};
  if(rows.length){
    const ar=await db.from("attachments").select("*").eq("item_type",view).in("item_id",rows.map(x=>String(x.id)));
    if(!ar.error)(ar.data||[]).forEach(a=>(attachmentsByItem[String(a.item_id)]??=[]).push(a));
  }
  $("#cards").innerHTML=rows.map(renderRow).join("");
  $$(".edit").forEach(b=>b.onclick=()=>openForm(view,rows.find(x=>String(x.id)===String(b.dataset.id))));
  $$(".del").forEach(b=>b.onclick=()=>remove(b.dataset.id));
  $$('[data-check]').forEach(b=>b.onchange=async()=>{
    const r=await db.from("todos").update({done:b.checked}).eq("id",b.dataset.check);
    if(r.error)alert(r.error.message);await load()
  });
  $$('[data-attachment-delete]').forEach(b=>b.onclick=()=>removeAttachment(b.dataset.attachmentDelete,b.dataset.path));
}
function renderRow(r){
  const att=attachmentsHtml(r.id);
  if(view==="food")return card(`🍽️ ${esc(r.name)}`,`${r.mrt?`🚇 ${esc(r.mrt)} `:""}${r.exit?`🚪 ${esc(r.exit)}號出口 `:""}${r.walk_minutes!=null?`🚶🏻‍♀️ ${r.walk_minutes} 分鐘`:""}`,safeUrl(r.maps_url)?`<a class="meta" href="${esc(safeUrl(r.maps_url))}" target="_blank" rel="noopener">🗺️ Google Maps</a>`:"",r,att);
  if(view==="wishlist")return card(`🛍️ ${esc(r.name)}`,r.purchase_place?`📍 ${esc(r.purchase_place)}`:"","",r,att);
  if(view==="watchlist")return card(`✦ ${esc(r.name)}`,"","",r,att);
  if(view==="memo")return `<article class="card"><div class="name">📝 ${esc(r.title||"未命名備忘錄")}${scopeBadge(r)}</div>${r.content?`<div class="memo-content">${esc(r.content).replace(/\n/g,"<br>")}</div>`:""}${memoUrlsHtml(r.urls)}${tableHtml(r.table_data)}${att}${actions(r.id)}</article>`;
  const range=formatRange(r.start_date||r.event_date,r.end_date);
  return `<article class="card"><div class="name"><input type="checkbox" data-check="${r.id}" ${r.done?"checked":""}> ${esc(r.title)}${scopeBadge(r)}</div>${range?`<div class="meta">📅 ${esc(range)}${r.event_time?` ⏰ ${esc(r.event_time)}`:""}</div>`:""}${r.location?`<div class="meta">📍 ${esc(r.location)}</div>`:""}${r.note?`<div class="meta">${esc(r.note)}</div>`:""}${att}${actions(r.id)}</article>`;
}
function formatDate(d){if(!d)return"";const p=String(d).split("-");return p.length===3?`${Number(p[0])}/${Number(p[1])}/${Number(p[2])}`:String(d)}
function formatRange(start,end){if(start&&end&&start!==end)return `${formatDate(start)} ～ ${formatDate(end)}`;return formatDate(start||end)}
function scopeBadge(r){return ""}
function card(n,m,x,r,att=""){return `<article class="card"><div class="name">${n}${scopeBadge(r)}</div>${m?`<div class="meta">${m}</div>`:""}${x?`<div>${x}</div>`:""}${r.note?`<div class="meta">${esc(r.note)}</div>`:""}${att}${actions(r.id)}</article>`}
function actions(id){return `<div class="actions"><button class="edit" data-id="${id}">✎ 編輯</button><button class="del" data-id="${id}">🗑 刪除</button></div>`}

function attachmentsHtml(id){
  const arr=attachmentsByItem[String(id)]||[];
  if(!arr.length)return"";
  return `<div class="attachments"><div class="attachment-title">📎 附件</div><div class="attachment-grid">${arr.map(a=>{const link=safeUrl(a.public_url);return link?`<div class="attachment-item"><a href="${esc(link)}" target="_blank" rel="noopener"><img src="${esc(link)}" alt="${esc(a.file_name)}"></a><button type="button" class="attachment-remove" data-attachment-delete="${esc(a.id)}" data-path="${esc(a.storage_path)}">×</button></div>`:""}).join("")}</div></div>`
}
function memoUrlsHtml(raw){
  if(!raw)return"";
  const urls=String(raw).split(/\n+/).map(x=>x.trim()).filter(Boolean);
  if(!urls.length)return"";
  return `<div class="memo-urls"><div class="attachment-title">🔗 網址</div>${urls.map(u=>{const link=safeUrl(u);return link?`<a href="${esc(link)}" target="_blank" rel="noopener">${esc(u)}</a>`:`<span class="meta">${esc(u)}</span>`}).join("")}</div>`
}
function tableHtml(raw){
  let data=raw;
  if(typeof data==="string"){try{data=JSON.parse(data)}catch{data=null}}
  if(!Array.isArray(data)||!data.length)return"";
  return `<div class="memo-table-wrap"><div class="attachment-title">▦ 表格</div><table class="memo-table"><tbody>${data.map(row=>`<tr>${(Array.isArray(row)?row:[]).map(c=>`<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
}

async function remove(id){
  if(!confirm("確定要刪除嗎？"))return;
  const {data:uData}=await db.auth.getUser(),u=uData.user;if(!u){alert("請先登入");return}
  const table=view==="todo"?"todos":view==="memo"?"memos":view;
  let r=db.from(table).delete().eq("id",id);
  if(selectedScope==="private")r=r.eq("user_id",u.id).is("share_group_id",null);
  else r=r.eq("share_group_id",selectedGroupId);
  r=await r;
  if(r.error){alert(r.error.message);return}
  const arr=attachmentsByItem[String(id)]||[];
  for(const a of arr){await db.storage.from(ATTACH_BUCKET).remove([a.storage_path]);}
  await db.from("attachments").delete().eq("item_id",String(id)).eq("item_type",view).eq("user_id",u.id);
  await load()
}

async function removeAttachment(id,path){
  if(!confirm("要刪除這張附件嗎？"))return;
  const {data:uData}=await db.auth.getUser(),u=uData.user;if(!u)return;
  const a=await db.storage.from(ATTACH_BUCKET).remove([path]);
  if(a.error){alert(a.error.message);return}
  let r=db.from("attachments").delete().eq("id",id);
  r=await r;
  if(r.error){alert(r.error.message);return}
  await load()
}

const field=(l,x)=>`<label>${l}${x}</label>`;
function shareField(r={}){return ""}


function attachmentField(){
  return `<div class="attachment-field"><label>📎 圖片附件</label><button type="button" id="allowImages" class="consent-btn">先同意使用圖片，再選擇圖片</button><input id="imageFiles" name="imageFiles" type="file" accept="image/*" multiple hidden><small>你可以一次選擇多張圖片。網站不會自動讀取你的整個相簿，只有你在系統選擇並確認的圖片才會被上傳。</small></div>`
}

function fields(t,r={}){
  const end=`<div class="actions2"><button type="button" class="cancel" id="cancel">取消</button><button class="save">儲存</button></div>`;
  if(t==="food")return field("店家名稱",`<input name="name" required value="${esc(r.name)}">`)+field("分類",`<select name="category">${cats.food.map(x=>`<option ${x===(r.category||cat)?"selected":""}>${x}</option>`).join("")}</select>`)+field("捷運站",`<input name="mrt" value="${esc(r.mrt)}">`)+field("幾號出口",`<input name="exit" value="${esc(r.exit)}">`)+field("走幾分鐘",`<input name="walk_minutes" type="number" min="0" value="${r.walk_minutes??""}">`)+field("Google Maps",`<input name="maps_url" type="url" value="${esc(r.maps_url)}">`)+field("備註",`<textarea name="note">${esc(r.note)}</textarea>`)+attachmentField()+end;
  if(t==="wishlist")return field("商品名稱",`<input name="name" required value="${esc(r.name)}">`)+field("地區",`<select name="country">${cats.wishlist.map(x=>`<option ${x===(r.country||cat)?"selected":""}>${x}</option>`).join("")}</select>`)+field("購買地點",`<input name="purchase_place" value="${esc(r.purchase_place)}">`)+field("備註",`<textarea name="note">${esc(r.note)}</textarea>`)+attachmentField()+end;
  if(t==="watchlist")return field("劇名／電影名",`<input name="name" required value="${esc(r.name)}">`)+field("分類",`<select name="category">${cats.watchlist.map(x=>`<option ${x===(r.category||cat)?"selected":""}>${x}</option>`).join("")}</select>`)+attachmentField()+end;
  if(t==="memo"){
    return shareField(r)+field("標題",`<input name="title" value="${esc(r.title)}">`)
      +field("內容",`<textarea name="content" class="memo-editor" placeholder="想記住什麼，就寫在這裡 ♡">${esc(r.content)}</textarea>`)
      +field("其他網址",`<textarea name="urls" placeholder="一行一個網址">${esc(r.urls)}</textarea>`)
      +tableEditor(r.table_data)
      +attachmentField()+end;
  }
  const start=r.start_date||r.event_date||"",endDate=r.end_date||"";
  return shareField(r)+field("類型",`<select name="event_type" id="todoType"><option ${((r.event_type||cat)==="提醒事項")?"selected":""}>提醒事項</option><option ${((r.event_type||cat)==="行程")?"selected":""}>行程</option></select>`)
    +field("名稱",`<input name="title" required value="${esc(r.title)}">`)
    +field("開始日期",`<input name="start_date" type="date" value="${esc(start)}">`)
    +field("結束日期",`<input name="end_date" type="date" value="${esc(endDate)}">`)
    +field("時間",`<input name="event_time" type="time" value="${esc(r.event_time)}">`)
    +field("地點",`<input name="location" value="${esc(r.location)}">`)
    +field("備註",`<textarea name="note">${esc(r.note)}</textarea>`)
    +attachmentField()+end;
}

function tableEditor(raw){
  let data=raw;
  if(typeof data==="string"){try{data=JSON.parse(data)}catch{data=null}}
  if(!Array.isArray(data)||!data.length)data=[["",""],["",""]];
  const safe=data.map(row=>Array.isArray(row)?row.map(x=>String(x??"")):["",""]);
  return `<div class="table-editor"><div class="table-editor-head"><span>▦ 表格</span><div><button type="button" id="addCol" class="mini">＋欄</button><button type="button" id="delCol" class="mini">－欄</button><button type="button" id="addRow" class="mini">＋列</button><button type="button" id="delRow" class="mini">－列</button></div></div><div id="tableGrid" class="table-grid">${safe.map((row,i)=>row.map((c,j)=>`<input data-row="${i}" data-col="${j}" value="${esc(c)}" placeholder="內容">`).join("")).join("")}</div></div>`
}
function readTable(){
  const cells=$$('#tableGrid input');if(!cells.length)return null;
  let maxR=-1,maxC=-1;cells.forEach(x=>{maxR=Math.max(maxR,+x.dataset.row);maxC=Math.max(maxC,+x.dataset.col)});
  const data=Array.from({length:maxR+1},(_,i)=>Array.from({length:maxC+1},(_,j)=>{const x=$(`#tableGrid input[data-row="${i}"][data-col="${j}"]`);return x?x.value:""}));
  if(data.every(row=>row.every(c=>!c.trim())))return null;
  return data;
}
function wireTable(){
  const grid=$("#tableGrid");if(!grid)return;
  const readGrid=()=>{
    const cells=$$('#tableGrid input');
    if(!cells.length)return [[""]];
    const maxR=Math.max(...cells.map(x=>+x.dataset.row),0),maxC=Math.max(...cells.map(x=>+x.dataset.col),0);
    return Array.from({length:maxR+1},(_,i)=>Array.from({length:maxC+1},(_,j)=>{const x=$(`#tableGrid input[data-row="${i}"][data-col="${j}"]`);return x?x.value:""}));
  };
  const draw=data=>{
    grid.innerHTML=data.map((row,i)=>row.map((c,j)=>`<input data-row="${i}" data-col="${j}" value="${esc(c)}" placeholder="內容">`).join("")).join("");
    grid.style.gridTemplateColumns=`repeat(${Math.max(data[0]?.length||1,1)},minmax(0,1fr))`;
  };
  const refresh=()=>{const data=readGrid();draw(data)};
  $("#addCol").onclick=()=>{const d=readGrid();d.forEach(r=>r.push(""));draw(d)};
  $("#delCol").onclick=()=>{const d=readGrid();if(d[0].length<=1)return;d.forEach(r=>r.pop());draw(d)};
  $("#addRow").onclick=()=>{const d=readGrid();d.push(Array(d[0].length).fill(""));draw(d)};
  $("#delRow").onclick=()=>{const d=readGrid();if(d.length<=1)return;d.pop();draw(d)};
  refresh();
}

function openForm(t,r=null){
  editing=r;
  $("#fmsg").textContent="";
  $("#modal").classList.remove("hidden");
  $("#mtitle").textContent=r?"編輯":"新增";
  $("#form").innerHTML=fields(t,r||{});
  $("#cancel").onclick=close;
  $("#form").onsubmit=e=>save(e,t);
  wireTable();
  const allow=$("#allowImages"),input=$("#imageFiles");
  if(allow&&input){
    allow.onclick=async()=>{
      const ok=confirm("圖片附件權限\n\n是否同意讓 My Little Space 在你主動選擇圖片後使用這些圖片？\n\n網站不會自行讀取整個相簿；你仍需要在系統的照片選擇器中手動選取要附加的圖片。");
      if(!ok)return;
      localStorage.setItem("myLittleSpaceImageConsent","yes");
      input.click();
    };
  }
}
function chooser(){
  $("#fmsg").textContent="";
  $("#modal").classList.remove("hidden");
  $("#mtitle").textContent="想新增什麼？";
  $("#form").innerHTML=`<div class="tiles"><button type="button" class="tile pink" data-new="food">🍽️ 食物</button><button type="button" class="tile purple" data-new="wishlist">🛍️ 想買</button><button type="button" class="tile blue" data-new="watchlist">🎬 影劇</button><button type="button" class="tile green" data-new="todo">🧩 生活管理</button><button type="button" class="tile memo-tile" data-new="memo">📝 備忘錄</button></div>`;
  $$('[data-new]').forEach(b=>b.onclick=()=>openForm(b.dataset.new))
}
function close(){$("#modal").classList.add("hidden");editing=null}

async function loadGroups(){
  const {data:uData}=await db.auth.getUser(),u=uData.user;if(!u)return;
  const r=await db.from("share_group_members").select("group_id, share_groups(id,name)").eq("user_id",u.id);
  groups=(r.error?[]:(r.data||[]).map(x=>x.share_groups).filter(Boolean));
}
async function shareManager(){
  await loadGroups();
  $("#modal").classList.remove("hidden");
  $("#mtitle").textContent="👥 共用備忘錄／生活管理";
  const groupHtml=groups.length
    ? groups.map(g=>`<div class="group-entry"><span>👥 ${esc(g.name)}</span><button type="button" class="mini enter-group" data-group-id="${esc(g.id)}">進入</button></div>`).join("")
    : `<div class="meta">目前還沒有共用群組。</div>`;
  $("#form").innerHTML=`
    <div class="share-panel">
      <div class="share-card">
        <b>建立共用群組</b>
        <p class="scope-note">例如「室友」「旅行」「家人」。建立後可以把備忘錄或生活管理內容放進這個群組。</p>
        <input id="newGroupName" placeholder="群組名稱">
        <input id="newGroupPass" type="text" placeholder="密碼" autocomplete="off">
        <div class="share-actions"><button type="button" class="primary" id="createGroup">建立群組</button></div>
      </div>
      <div class="share-card">
        <b>加入共用群組</b>
        <p class="scope-note">輸入對方提供的群組名稱與密碼即可加入。</p>
        <input id="joinGroupName" placeholder="群組名稱">
        <input id="joinGroupPass" type="text" placeholder="密碼" autocomplete="off">
        <div class="share-actions"><button type="button" class="primary" id="joinGroup">加入群組</button></div>
      </div>
      <div class="share-card"><b>我目前的群組</b><div id="groupList">${groupHtml}</div></div>
      <div class="actions2"><button type="button" class="cancel" id="cancel">關閉</button></div>
    </div>`;
  $("#cancel").onclick=close;
  $$(".enter-group").forEach(b=>b.onclick=()=>{selectedScope="group";selectedGroupId=b.dataset.groupId;close();$("#title").textContent=(view==="todo"?"生活管理":view==="memo"?"備忘錄":"")+" · "+(groups.find(g=>g.id===selectedGroupId)?.name||"群組");renderCats();load();});
  $("#createGroup").onclick=async()=>{
    const name=$("#newGroupName").value.trim(),pass=$("#newGroupPass").value;
    if(!name||!pass){alert("請輸入群組名稱與密碼");return}
    const r=await db.rpc("create_share_group",{p_name:name,p_passcode:pass});
    if(r.error){alert(r.error.message);return}
    await loadGroups();alert("群組建立好了！");await shareManager();
  };
  $("#joinGroup").onclick=async()=>{
    const name=$("#joinGroupName").value.trim(),pass=$("#joinGroupPass").value;
    if(!name||!pass){alert("請輸入群組名稱與密碼");return}
    const r=await db.rpc("join_share_group",{p_name:name,p_passcode:pass});
    if(r.error){alert(r.error.message);return}
    await loadGroups();alert("已加入群組！");await shareManager();
  };
}
$("#share").onclick=shareManager;


async function uploadAttachments(t,itemId,userId,input){
  const files=[...(input?.files||[])];
  if(!files.length)return;
  if(localStorage.getItem("myLittleSpaceImageConsent")!=="yes"){
    throw new Error("請先同意使用圖片附件。")
  }
  for(const file of files){
    if(!file.type.startsWith("image/"))continue;
    const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,8)||"jpg";
    const path=`${userId}/${t}/${itemId}/${crypto.randomUUID()}.${ext}`;
    const up=await db.storage.from(ATTACH_BUCKET).upload(path,file,{upsert:false,contentType:file.type});
    if(up.error)throw up.error;
    const pub=db.storage.from(ATTACH_BUCKET).getPublicUrl(path);
    const ins=await db.from("attachments").insert({user_id:userId,item_type:t,item_id:String(itemId),file_name:file.name,storage_path:path,public_url:pub.data.publicUrl});
    if(ins.error)throw ins.error;
  }
}

async function save(e,t){
  e.preventDefault();$("#fmsg").textContent="";
  const v=Object.fromEntries(new FormData(e.target).entries());
  const {data:uData}=await db.auth.getUser(),u=uData.user;
  if(!u){$("#fmsg").textContent="登入狀態已失效，請重新登入。";return}
  delete v.imageFiles;
  delete v.share_group_id;
  v.share_group_id=(view==="memo"||view==="todo") && selectedScope==="group" ? selectedGroupId : null;
  if(t==="food"&&v.walk_minutes==="")v.walk_minutes=null;
  if(t==="todo"){
    if(!v.start_date)v.start_date=null;
    if(!v.end_date)v.end_date=null;
    if(!v.event_time)v.event_time=null;
    if(v.start_date&&v.end_date&&v.end_date<v.start_date){$("#fmsg").textContent="結束日期不能早於開始日期。";return}
    v.done=editing?.done??false;
  }
  if(t==="memo"){
    v.table_data=JSON.stringify(readTable());
    if(v.table_data==="null")v.table_data=null;
  }
  const table=t==="todo"?"todos":t==="memo"?"memos":t;
  let r;
  if(editing){
    let q=db.from(table).update(v).eq("id",editing.id);
    if(selectedScope==="private")q=q.eq("user_id",u.id).is("share_group_id",null);
    else q=q.eq("share_group_id",selectedGroupId);
    r=await q;
  }else{
    r=await db.from(table).insert({...v,user_id:u.id}).select().single();
  }
  if(r.error){$("#fmsg").textContent=r.error.message;return}
  const itemId=editing?.id||r.data?.id;
  try{
    await uploadAttachments(t,itemId,u.id,$("#imageFiles"));
  }catch(err){
    $("#fmsg").textContent="資料已儲存，但圖片附件上傳失敗："+(err.message||err);
    return;
  }
  close();if(view===t||(view==="todo"&&t==="todo")||(view==="memo"&&t==="memo"))await load();
}

async function loadUserName(){
  const {data,error}=await db.auth.getUser(),u=data.user;
  if(error||!u)return;
  let name=typeof u.user_metadata?.display_name==="string"?u.user_metadata.display_name.trim():"";
  if(!name){name="user";const r=await db.auth.updateUser({data:{display_name:name}});if(r.error)console.error(r.error)}
  $("#userName").textContent=name
}
async function editUserName(){
  const {data}=await db.auth.getUser(),current=data.user?.user_metadata?.display_name||"user";
  const name=prompt("想顯示什麼名字？",current);if(name===null)return;
  const clean=name.trim().slice(0,30);if(!clean)return;
  const r=await db.auth.updateUser({data:{display_name:clean}});
  if(r.error){alert(r.error.message);return}
  $("#userName").textContent=clean
}
$("#editName").onclick=editUserName;
db.auth.getSession().then(({data})=>data.session?showApp():showAuth());
db.auth.onAuthStateChange((_e,s)=>s?showApp():showAuth());
function showAuth(){$("#auth").classList.remove("hidden");$("#app").classList.add("hidden")}
function showApp(){$("#auth").classList.add("hidden");$("#app").classList.remove("hidden");loadUserName();home()}
