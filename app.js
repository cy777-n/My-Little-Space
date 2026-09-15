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
let view="home",cat=null,editing=null,rows=[],register=false,attachmentsByItem={},groups=[],selectedScope="private",selectedGroupId=null,starredGroups=[],customCats={},groupOrder=[],currentUserId=null;

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
$("#scopePicker").onchange=e=>selectScope(e.target.value);
$("#close").onclick=close;
$("#closePhoto").onclick=closePhoto;
$("#photoViewer").querySelector(".photo-shade").onclick=closePhoto;
document.addEventListener("keydown",e=>{if(e.key==="Escape")closePhoto()});

function home(){$("#home").classList.remove("hidden");$("#list").classList.add("hidden");view="home";renderScopePicker()}

function openView(v){
  view=v;
  cat=v==="todo"?"提醒事項":v==="memo"?null:cats[v][0];
  $("#home").classList.add("hidden");
  $("#list").classList.remove("hidden");
  $("#title").textContent=areaTitle(v);
  $("#share").classList.add("hidden");
  renderCats();
  load()
}
function catArea(){return view==="todo"?"todo":view==="memo"?"memo":view}
function catColumn(){return view==="todo"?"event_type":view==="wishlist"?"country":"category"}
function categoryScopeKey(){return selectedScope==="group"&&selectedGroupId?`group:${selectedGroupId}`:`user:${currentUserId||""}`}
function customCategoryList(){return customCats[categoryScopeKey()]?.[catArea()]||[]}
function allCategories(){return customCategoryList()}
function defaultCategoriesForArea(area){return area==="todo"?["提醒事項","行程"]:area==="memo"?[]:(cats[area]||[])}
function renderCats(){
  if(view==="memo"){ $("#cats").innerHTML=""; return; }
  const list=allCategories();
  $("#cats").innerHTML=list.map(c=>`<div class="cat-wrap"><button class="${c===cat?"active":""}" data-cat="${esc(c)}">${esc(c)}</button><button type="button" class="cat-remove" data-remove-cat="${esc(c)}" title="刪除分類" aria-label="刪除分類 ${esc(c)}">×</button></div>`).join("")+`<button type="button" class="cat-add" id="addCategory">＋ 類別</button>`;
  $$('[data-cat]').forEach(b=>b.onclick=()=>{cat=b.dataset.cat;renderCats();load()});
  $$('[data-remove-cat]').forEach(b=>b.onclick=()=>removeCustomCategory(b.dataset.removeCat));
  $("#addCategory").onclick=addCustomCategory;
  enableCategoryDrag();
}
function filterColumn(){return catColumn()}
async function loadCategories(){
  const {data:uData}=await db.auth.getUser(),u=uData.user;if(!u)return;
  currentUserId=u.id; const scopeKey=categoryScopeKey();
  let q=db.from("space_categories").select("id,area,label,sort_order,user_id,share_group_id");
  let iq=db.from("space_category_scopes").select("area,defaults_migrated,defaults_restored_v27");
  if(selectedScope==="group"&&selectedGroupId){q=q.eq("share_group_id",selectedGroupId);iq=iq.eq("share_group_id",selectedGroupId)}else{q=q.eq("user_id",u.id).is("share_group_id",null);iq=iq.eq("user_id",u.id).is("share_group_id",null)}
  const [r,ir]=await Promise.all([q.order("sort_order",{ascending:true}),iq]);
  if(r.error){console.error(r.error);return}
  if(ir.error){console.error(ir.error);return}
  customCats[scopeKey]={}; const existing=(r.data||[]).filter(x=>!(x.area==="memo"&&x.label==="全部")), initialized=new Set((ir.data||[]).map(x=>x.area));
  for(const area of ["food","wishlist","watchlist","todo","memo"]){
    let areaRows=existing.filter(x=>x.area===area).sort((a,b)=>a.sort_order-b.sort_order);
    let ownerId=u.id,groupId=null;
    if(selectedScope==="group"&&selectedGroupId){const g=groups.find(x=>x.id===selectedGroupId);if(!g)continue;groupId=selectedGroupId;ownerId=g.owner_id||u.id;}
    const scopeRow=(ir.data||[]).find(x=>x.area===area);
    if(!scopeRow){
      const defaults=defaultCategoriesForArea(area);
      const present=new Set(areaRows.map(x=>x.label));
      const missing=defaults.filter(x=>!present.has(x));
      if(missing.length){const payload=missing.map((label,i)=>({user_id:selectedScope==="private"?u.id:ownerId,share_group_id:groupId,area,label,sort_order:areaRows.length+i}));const ins=await db.from("space_categories").insert(payload);if(ins.error){console.error(ins.error);continue}areaRows=areaRows.concat(payload)}
      const marker={user_id:selectedScope==="private"?u.id:ownerId,share_group_id:groupId,area,defaults_migrated:true,defaults_restored_v27:true};
      const mi=await db.from("space_category_scopes").insert(marker);if(mi.error){console.error(mi.error)}
    } else if(scopeRow.defaults_restored_v27!==true){
      // v27 one-time repair: restore any original built-in categories that
      // disappeared in v25/v26. After this repair, built-ins are ordinary
      // user-managed categories and can be deleted/reordered permanently.
      const defaults=defaultCategoriesForArea(area);
      const present=new Set(areaRows.map(x=>x.label));
      const missing=defaults.filter(x=>!present.has(x));
      if(missing.length){
        const payload=missing.map((label,i)=>({user_id:selectedScope==="private"?u.id:ownerId,share_group_id:groupId,area,label,sort_order:areaRows.length+i}));
        const ins=await db.from("space_categories").insert(payload);
        if(ins.error){console.error(ins.error);continue}
        areaRows=areaRows.concat(payload);
      }
      // Put the restored built-ins back in their original order, followed by
      // any user-created categories that already existed.
      const byLabel=new Map(areaRows.map(x=>[x.label,x]));
      const desired=[...defaults.filter(x=>byLabel.has(x)),...areaRows.filter(x=>!defaults.includes(x.label)).sort((a,b)=>a.sort_order-b.sort_order).map(x=>x.label)];
      const normalized=desired.map(x=>typeof x==="string"?byLabel.get(x):x);
      for(let i=0;i<normalized.length;i++){const row=normalized[i];let uq=db.from("space_categories").update({sort_order:i}).eq("id",row.id);const ur=await uq;if(ur.error){console.error(ur.error);break}}
      areaRows=normalized;
      let mq=db.from("space_category_scopes").update({defaults_migrated:true,defaults_restored_v27:true}).eq("area",area);
      if(selectedScope==="group"&&selectedGroupId)mq=mq.eq("share_group_id",selectedGroupId);else mq=mq.eq("user_id",u.id).is("share_group_id",null);
      const mr=await mq;if(mr.error)console.error(mr.error);
    }
    customCats[scopeKey][area]=areaRows.sort((a,b)=>a.sort_order-b.sort_order).map(x=>x.label);
  }
}
async function addCustomCategory(){
  const label=prompt("新增分類名稱");if(label===null)return;
  const clean=label.trim().slice(0,30);if(!clean)return;
  if(allCategories().includes(clean)){alert("這個分類已經存在。");return}
  const {data:uData}=await db.auth.getUser(),u=uData.user;if(!u)return;
  let ownerId=u.id,groupId=null;
  if(selectedScope==="group"&&selectedGroupId){const g=groups.find(x=>x.id===selectedGroupId);if(!g){alert("找不到群組");return}groupId=selectedGroupId;ownerId=g.owner_id||u.id;}
  const r=await db.from("space_categories").insert({user_id:selectedScope==="private"?u.id:ownerId,share_group_id:groupId,area:catArea(),label:clean,sort_order:allCategories().length}).select().single();
  if(r.error){alert(r.error.message);return} await loadCategories();cat=clean;renderCats();load();
}
async function removeCustomCategory(label){
  if(!await askConfirm(`確定要刪除「${label}」嗎？\n\n這個分類會從選單移除，已存在的資料不會被刪除。`))return;
  let q=db.from("space_categories").delete().eq("area",catArea()).eq("label",label);
  if(selectedScope==="group"&&selectedGroupId)q=q.eq("share_group_id",selectedGroupId);else{const {data:uData}=await db.auth.getUser();q=q.eq("user_id",uData.user.id).is("share_group_id",null)}
  const r=await q;if(r.error){alert(r.error.message);return} await loadCategories();cat=allCategories()[0]||"";renderCats();load();
}
async function reorderCustomCategories(labels){
  const {data:uData}=await db.auth.getUser(),u=uData.user;if(!u)return;
  for(let i=0;i<labels.length;i++){let q=db.from("space_categories").update({sort_order:i}).eq("area",catArea()).eq("label",labels[i]);if(selectedScope==="group"&&selectedGroupId)q=q.eq("share_group_id",selectedGroupId);else q=q.eq("user_id",u.id).is("share_group_id",null);const r=await q;if(r.error){alert(r.error.message);return}}
  await loadCategories();renderCats();
}
function enableCategoryDrag(){
  const wrap=$("#cats");if(!wrap)return;
  $$(".cat-wrap",wrap).forEach(w=>{w.draggable=true;w.ondragstart=e=>{e.dataTransfer.setData("text/plain",w.querySelector("[data-cat]").dataset.cat);w.classList.add("dragging")};w.ondragend=()=>w.classList.remove("dragging");w.ondragover=e=>e.preventDefault();w.ondrop=e=>{e.preventDefault();const from=e.dataTransfer.getData("text/plain"),to=w.querySelector("[data-cat]")?.dataset.cat;if(!from||!to||from===to)return;const arr=[...allCategories()],a=arr.indexOf(from),b=arr.indexOf(to);if(a<0||b<0)return;arr.splice(a,1);arr.splice(b,0,from);reorderCustomCategories(arr)};});
}
async function load(){
  const table=view==="todo"?"todos":view==="memo"?"memos":view;
  const {data:uData}=await db.auth.getUser(),u=uData.user;
  if(!u)return;
  await loadGroups();
  await loadCategories();
  if(!allCategories().includes(cat))cat=allCategories()[0]||"";
  renderCats();
  let q;
  if(view==="memo"||view==="todo") {
    if(selectedScope==="group" && selectedGroupId){
      q=db.from(table).select("*").eq("share_group_id",selectedGroupId);
    }else{
      q=db.from(table).select("*").eq("user_id",u.id).is("share_group_id",null);
    }
    if(view!=="memo" && cat)q=q.eq(filterColumn(),cat);
    if(view==="memo" && cat && cat!=="全部")q=q.eq("category",cat);
  } else {
    if(selectedScope==="group" && selectedGroupId){
      q=db.from(table).select("*").eq("share_group_id",selectedGroupId);
    }else{
      q=db.from(table).select("*").eq("user_id",u.id).is("share_group_id",null);
    }
    if(view!=="memo" && cat)q=q.eq(filterColumn(),cat);
    if(view==="memo" && cat && cat!=="全部")q=q.eq("category",cat);
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
  $$('[data-photo-url]').forEach(b=>b.onclick=()=>openPhoto(b.dataset.photoUrl,b.dataset.photoName));
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
  return `<div class="attachments"><div class="attachment-title">📎 附件</div><div class="attachment-grid">${arr.map(a=>{const link=safeUrl(a.public_url);return link?`<div class="attachment-item"><button type="button" class="attachment-preview" data-photo-url="${esc(link)}" data-photo-name="${esc(a.file_name)}"><img src="${esc(link)}" alt="${esc(a.file_name)}"></button><button type="button" class="attachment-remove" data-attachment-delete="${esc(a.id)}" data-path="${esc(a.storage_path)}">×</button></div>`:""}).join("")}</div></div>`
}
function openPhoto(url,name="圖片") {
  const viewer=$("#photoViewer"),img=$("#photoViewerImg");
  if(!viewer||!img)return;
  img.src=url;
  img.alt=name;
  $("#photoViewerName").textContent=name||"圖片";
  viewer.classList.remove("hidden");
  document.body.classList.add("photo-open");
}
function closePhoto() {
  const viewer=$("#photoViewer"),img=$("#photoViewerImg");
  if(!viewer)return;
  viewer.classList.add("hidden");
  document.body.classList.remove("photo-open");
  if(img)img.src="";
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
  if(!await askConfirm("確定要刪除這筆內容嗎？"))return;
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
  if(!await askConfirm("確定要刪除這張照片嗎？"))return;
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

function areaTitle(v){
  const base=v==="todo"?"生活管理":v==="food"?"食物":v==="wishlist"?"購物":v==="watchlist"?"影劇":"備忘錄";
  if(selectedScope==="group"&&selectedGroupId){return `${base} · ${groups.find(g=>g.id===selectedGroupId)?.name||"群組"}`}
  return `${base} · 個人`;
}

function starKey(){return `my-little-space-starred-groups-${db?.auth?"user":""}`;}
async function loadStarredGroups(){
  const {data}=await db.auth.getUser();
  const id=data?.user?.id;
  if(!id){starredGroups=[];return;}
  try{starredGroups=JSON.parse(localStorage.getItem(`my-little-space-starred-groups-${id}`)||"[]").filter(Boolean)}catch{starredGroups=[]}
}
async function toggleStarGroup(id){
  const {data}=await db.auth.getUser();
  const uid=data?.user?.id;if(!uid)return;
  starredGroups=starredGroups.includes(id)?starredGroups.filter(x=>x!==id):[...starredGroups,id];
  localStorage.setItem(`my-little-space-starred-groups-${uid}`,JSON.stringify(starredGroups));
  renderScopePicker();
}
function renderScopePicker(){
  const el=$("#scopePicker");if(!el)return;
  const current=selectedScope==="group"&&selectedGroupId?groups.find(g=>g.id===selectedGroupId):null;
  const sorted=sortedGroupsList();
  el.innerHTML=`<button type="button" class="scope-current"><span>${current?"👥":"👤"} ${esc(current?.name||"個人")}</span><span class="scope-chevron">⌄</span></button><div class="scope-menu hidden"><button type="button" class="scope-option ${!current?"active":""}" data-scope="private"><span>👤 個人</span></button>${sorted.map(g=>`<div class="scope-option-wrap"><button type="button" class="scope-option ${current?.id===g.id?"active":""}" data-scope="group:${esc(g.id)}"><span>${starredGroups.includes(g.id)?"⭐":"👥"} ${esc(g.name)}</span></button><button type="button" class="scope-star ${starredGroups.includes(g.id)?"starred":""}" data-star-id="${esc(g.id)}" title="${starredGroups.includes(g.id)?"取消標記":"標記"}">${starredGroups.includes(g.id)?"★":"☆"}</button></div>`).join("")}</div>`;
  $(".scope-current",el).onclick=()=>$(".scope-menu",el).classList.toggle("hidden");
  $$(".scope-option",el).forEach(b=>b.onclick=()=>selectScope(b.dataset.scope));
  $$(".scope-star",el).forEach(b=>b.onclick=e=>{e.stopPropagation();toggleStarGroup(b.dataset.starId)});
  $("#groupManage").onclick=shareManager;
}
function selectScope(value){
  if(value==="private"){selectedScope="private";selectedGroupId=null;}
  else{selectedScope="group";selectedGroupId=value.slice(6);}
  renderScopePicker();
  const menu=$(".scope-menu");if(menu)menu.classList.add("hidden");
  if(view!=="home"){$("#title").textContent=areaTitle(view);load();}
}

function attachmentField(){
  return `<div class="attachment-field"><label>📎 圖片附件</label><button type="button" id="allowImages" class="consent-btn">先同意使用圖片，再選擇圖片</button><input id="imageFiles" name="imageFiles" type="file" accept="image/*" multiple hidden><small>你可以一次選擇多張圖片。網站不會自動讀取你的整個相簿，只有你在系統選擇並確認的圖片才會被上傳。</small></div>`
}

function fields(t,r={}){
  const end=`<div class="actions2"><button type="button" class="cancel" id="cancel">取消</button><button class="save">儲存</button></div>`;
  if(t==="food")return field("店家名稱",`<input name="name" required value="${esc(r.name)}">`)+field("分類",`<select name="category">${allCategories().filter(x=>x!=="全部").map(x=>`<option ${x===(r.category||cat)?"selected":""}>${x}</option>`).join("")}</select>`)+field("捷運站",`<input name="mrt" value="${esc(r.mrt)}">`)+field("幾號出口",`<input name="exit" value="${esc(r.exit)}">`)+field("走幾分鐘",`<input name="walk_minutes" type="number" min="0" value="${r.walk_minutes??""}">`)+field("Google Maps",`<input name="maps_url" type="url" value="${esc(r.maps_url)}">`)+field("備註",`<textarea name="note">${esc(r.note)}</textarea>`)+attachmentField()+end;
  if(t==="wishlist")return field("商品名稱",`<input name="name" required value="${esc(r.name)}">`)+field("地區",`<select name="country">${allCategories().filter(x=>x!=="全部").map(x=>`<option ${x===(r.country||cat)?"selected":""}>${x}</option>`).join("")}</select>`)+field("購買地點",`<input name="purchase_place" value="${esc(r.purchase_place)}">`)+field("備註",`<textarea name="note">${esc(r.note)}</textarea>`)+attachmentField()+end;
  if(t==="watchlist")return field("劇名／電影名",`<input name="name" required value="${esc(r.name)}">`)+field("分類",`<select name="category">${allCategories().filter(x=>x!=="全部").map(x=>`<option ${x===(r.category||cat)?"selected":""}>${x}</option>`).join("")}</select>`)+attachmentField()+end;
  if(t==="memo"){
    return shareField(r)+field("標題",`<input name="title" value="${esc(r.title)}">`)
      +field("內容",`<textarea name="content" class="memo-editor" placeholder="想記住什麼，就寫在這裡 ♡">${esc(r.content)}</textarea>`)
      +field("其他網址",`<textarea name="urls" placeholder="一行一個網址">${esc(r.urls)}</textarea>`)
      +tableEditor(r.table_data)
      +attachmentField()+end;
  }
  const start=r.start_date||r.event_date||"",endDate=r.end_date||"";
  return shareField(r)+field("類型",`<select name="event_type" id="todoType">${allCategories().map(x=>`<option ${x===(r.event_type||cat)?"selected":""}>${x}</option>`).join("")}</select>`)
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
  $("#delCol").onclick=async()=>{if(!await askConfirm("確定要刪除這一欄嗎？刪除後這一欄的內容會一起移除。"))return;const d=readGrid();if(d[0].length<=1)return;d.forEach(r=>r.pop());draw(d)};
  $("#addRow").onclick=()=>{const d=readGrid();d.push(Array(d[0].length).fill(""));draw(d)};
  $("#delRow").onclick=async()=>{if(!await askConfirm("確定要刪除這一列嗎？刪除後這一列的內容會一起移除。"))return;const d=readGrid();if(d.length<=1)return;d.pop();draw(d)};
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
  $("#form").innerHTML=`<div class="tiles"><button type="button" class="tile pink" data-new="food">🍽️ 食物</button><button type="button" class="tile purple" data-new="wishlist">🛍️ 購物</button><button type="button" class="tile blue" data-new="watchlist">🎬 影劇</button><button type="button" class="tile green" data-new="todo">🧩 生活管理</button><button type="button" class="tile memo-tile" data-new="memo">📝 備忘錄</button></div>`;
  $$('[data-new]').forEach(b=>b.onclick=()=>openForm(b.dataset.new))
}
function close(){$("#modal").classList.add("hidden");editing=null}
function askConfirm(message,yesText="是",noText="否"){return new Promise(resolve=>{const m=$("#confirmModal");if(!m){resolve(false);return}$("#confirmText").textContent=message;$("#confirmYes").textContent=yesText;$("#confirmNo").textContent=noText;m.classList.remove("hidden");const done=v=>{m.classList.add("hidden");$("#confirmYes").onclick=null;$("#confirmNo").onclick=null;resolve(v)};$("#confirmYes").onclick=()=>done(true);$("#confirmNo").onclick=()=>done(false)})}

async function loadGroups(){
  const {data:uData}=await db.auth.getUser(),u=uData.user;if(!u)return;
  currentUserId=u.id;
  await loadStarredGroups();
  const r=await db.from("share_group_members").select("group_id, share_groups(id,name,owner_id)").eq("user_id",u.id);
  groups=(r.error?[]:(r.data||[]).map(x=>x.share_groups).filter(Boolean));
  starredGroups=starredGroups.filter(id=>groups.some(g=>g.id===id));
}
function groupOrderKey(){return `my-little-space-group-order-${currentUserId||""}`}
function loadGroupOrder(){try{groupOrder=JSON.parse(localStorage.getItem(groupOrderKey())||"[]").filter(Boolean)}catch{groupOrder=[]}}
function saveGroupOrder(){localStorage.setItem(groupOrderKey(),JSON.stringify(groupOrder))}
function sortedGroupsList(){loadGroupOrder();return [...groups].sort((a,b)=>{const sa=starredGroups.includes(a.id)?0:1,sb=starredGroups.includes(b.id)?0:1;if(sa!==sb)return sa-sb;const ia=groupOrder.indexOf(a.id),ib=groupOrder.indexOf(b.id);if(ia<0&&ib<0)return a.name.localeCompare(b.name,"zh-Hant");if(ia<0)return 1;if(ib<0)return -1;return ia-ib})}
async function leaveGroup(id){if(!await askConfirm("確定要退出這個群組嗎？退出後你將無法再看到群組內容，之後可以用群組名稱與密碼重新加入。"))return;const r=await db.rpc("leave_share_group",{p_group_id:id});if(r.error){alert(r.error.message);return}groups=groups.filter(g=>g.id!==id);starredGroups=starredGroups.filter(x=>x!==id);groupOrder=groupOrder.filter(x=>x!==id);saveGroupOrder();if(selectedGroupId===id){selectedScope="private";selectedGroupId=null;}renderScopePicker();await shareManager()}
async function shareManager(){
  await loadGroups();
  loadGroupOrder();
  $("#modal").classList.remove("hidden");
  $("#mtitle").textContent="👥 群組空間管理";
  const sortedGroups=sortedGroupsList();
  const groupHtml=sortedGroups.length
    ? sortedGroups.map(g=>`<div class="group-entry ${starredGroups.includes(g.id)?"is-starred":""}" draggable="true" data-group-drag="${esc(g.id)}"><span>${starredGroups.includes(g.id)?"⭐":"👥"} ${esc(g.name)}</span><div class="group-entry-actions"><button type="button" class="mini star-group ${starredGroups.includes(g.id)?"starred":""}" data-star-id="${esc(g.id)}">${starredGroups.includes(g.id)?"★":"☆"}</button><button type="button" class="mini enter-group" data-group-id="${esc(g.id)}">進入</button><button type="button" class="mini leave-group" data-group-id="${esc(g.id)}">退出</button></div></div>`).join("")
    : `<div class="meta">目前還沒有共用群組。</div>`;
  $("#form").innerHTML=`
    <div class="share-panel">
      <div class="share-card">
        <b>建立共用群組</b>
        <p class="scope-note">建立後，這個群組可以共用食物、購物、影劇、生活管理與備忘錄。</p>
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
      <div class="share-card"><b>我目前的群組</b><div id="groupList">${groupHtml}</div><small class="scope-note">拖曳群組可以調整順序。</small></div>
      <div class="actions2"><button type="button" class="cancel" id="cancel">關閉</button></div>
    </div>`;
  $("#cancel").onclick=close;
  $$(".star-group").forEach(b=>b.onclick=async()=>{await toggleStarGroup(b.dataset.starId);await shareManager();});
  $$(".enter-group").forEach(b=>b.onclick=()=>{selectedScope="group";selectedGroupId=b.dataset.groupId;close();renderScopePicker();if(view!=="home"){$("#title").textContent=areaTitle(view);renderCats();load();}});
  $$(".leave-group").forEach(b=>b.onclick=()=>leaveGroup(b.dataset.groupId));
  let dragId=null;
  $$('[data-group-drag]').forEach(el=>{el.ondragstart=e=>{dragId=el.dataset.groupDrag;el.classList.add("dragging")};el.ondragend=()=>el.classList.remove("dragging");el.ondragover=e=>e.preventDefault();el.ondrop=e=>{e.preventDefault();const to=el.dataset.groupDrag;if(!dragId||dragId===to)return;const arr=sortedGroupsList().map(g=>g.id),a=arr.indexOf(dragId),b=arr.indexOf(to);arr.splice(a,1);arr.splice(b,0,dragId);groupOrder=arr;saveGroupOrder();shareManager();}});
  $("#createGroup").onclick=async()=>{const name=$("#newGroupName").value.trim(),pass=$("#newGroupPass").value;if(!name||!pass){alert("請輸入群組名稱與密碼");return}const r=await db.rpc("create_share_group",{p_name:name,p_passcode:pass});if(r.error){alert(r.error.message);return}await loadGroups();renderScopePicker();alert("群組建立好了！");await shareManager();};
  $("#joinGroup").onclick=async()=>{const name=$("#joinGroupName").value.trim(),pass=$("#joinGroupPass").value;if(!name||!pass){alert("請輸入群組名稱與密碼");return}const r=await db.rpc("join_share_group",{p_name:name,p_passcode:pass});if(r.error){alert(r.error.message);return}await loadGroups();renderScopePicker();alert("已加入群組！");await shareManager();};
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
  v.share_group_id=selectedScope==="group" ? selectedGroupId : null;
  if(t==="food"&&v.walk_minutes==="")v.walk_minutes=null;
  if(t==="todo"){
    if(!v.start_date)v.start_date=null;
    if(!v.end_date)v.end_date=null;
    if(!v.event_time)v.event_time=null;
    if(v.start_date&&v.end_date&&v.end_date<v.start_date){$("#fmsg").textContent="結束日期不能早於開始日期。";return}
    v.done=editing?.done??false;
  }
  if(t==="memo"){
    v.category=null;
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
async function showApp(){$("#auth").classList.add("hidden");$("#app").classList.remove("hidden");loadUserName();await loadGroups();home()}
