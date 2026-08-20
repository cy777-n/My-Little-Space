const db=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY),$=x=>document.querySelector(x),$$=x=>[...document.querySelectorAll(x)],esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cats={food:["日式","韓式","義式","咖啡廳","餐酒館","其他"],wishlist:["台灣","日本","其他"],watchlist:["韓劇","陸劇","電影"]};
let view="home",cat=null,editing=null,rows=[],register=false;

$("#switch").onclick=()=>{register=!register;$("#login button").textContent=register?"註冊":"登入";$("#switch").textContent=register?"已經有帳號？登入":"還沒有帳號？註冊";$("#hint").textContent=register?"建立帳號後就可以保存你的資料。":"登入後就可以保存你的資料。"};
$("#login").onsubmit=async e=>{e.preventDefault();const email=$("#email").value.trim(),password=$("#pw").value;const r=register?await db.auth.signUp({email,password}):await db.auth.signInWithPassword({email,password});$("#msg").textContent=r.error?r.error.message:(register&&!r.data.session?"註冊成功，請驗證 Email 後登入。":"")};
$("#logout").onclick=()=>db.auth.signOut();
$$('[data-view]').forEach(b=>b.onclick=()=>openView(b.dataset.view));
$("#back").onclick=home;$("#add").onclick=chooser;$("#add2").onclick=()=>openForm(view);$("#close").onclick=close;

function home(){$("#home").classList.remove("hidden");$("#list").classList.add("hidden");view="home"}
function openView(v){view=v;cat=v==="todo"?"提醒事項":cats[v][0];$("#home").classList.add("hidden");$("#list").classList.remove("hidden");$("#title").textContent=v==="todo"?"生活管理":v==="food"?"食物":v==="wishlist"?"想買":"影劇";renderCats();load()}
function renderCats(){const list=view==="todo"?["提醒事項","行程"]:cats[view];$("#cats").innerHTML=list.map(c=>`<button class="${c===cat?"active":""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");$$('[data-cat]').forEach(b=>b.onclick=()=>{cat=b.dataset.cat;renderCats();load()})}
function filterColumn(){return view==="todo"?"event_type":view==="wishlist"?"country":"category"}

async function load(){
  const table=view==="todo"?"todos":view;
  const {data:uData}=await db.auth.getUser();const u=uData.user;if(!u)return;
  const r=await db.from(table).select("*").eq("user_id",u.id).eq(filterColumn(),cat).order("created_at",{ascending:false});
  if(r.error){console.error(r.error);$("#cards").innerHTML=`<p class="meta">${esc(r.error.message)}</p>`;return}
  rows=r.data||[];
  $("#cards").innerHTML=rows.map(renderRow).join("");
  $$(".edit").forEach(b=>b.onclick=()=>openForm(view,rows.find(x=>x.id===b.dataset.id)));
  $$(".del").forEach(b=>b.onclick=()=>remove(b.dataset.id));
  $$('[data-check]').forEach(b=>b.onchange=async()=>{const {data:uData}=await db.auth.getUser();const u=uData.user;if(!u)return;const r=await db.from("todos").update({done:b.checked}).eq("id",b.dataset.check).eq("user_id",u.id);if(r.error)alert(r.error.message);await load()});
}
function renderRow(r){
  if(view==="food")return card(`🍽️ ${esc(r.name)}`,`${r.mrt?`🚇 ${esc(r.mrt)} `:""}${r.exit?`🚪 ${esc(r.exit)}號出口 `:""}${r.walk_minutes!=null?`🚶🏻‍♀️ ${r.walk_minutes} 分鐘`:""}`,r.maps_url?`<a class="meta" href="${esc(r.maps_url)}" target="_blank" rel="noopener">🗺️ Google Maps</a>`:"",r);
  if(view==="wishlist")return card(`🛍️ ${esc(r.name)}`,r.purchase_place?`📍 ${esc(r.purchase_place)}`:"","",r);
  if(view==="watchlist")return card(`✦ ${esc(r.name)}`,"","",r);
  const range=formatRange(r.start_date||r.event_date,r.end_date);
  return `<article class="card"><div class="name"><input type="checkbox" data-check="${r.id}" ${r.done?"checked":""}> ${esc(r.title)}</div>${range?`<div class="meta">📅 ${esc(range)}${r.event_time?` ⏰ ${esc(r.event_time)}`:""}</div>`:""}${r.location?`<div class="meta">📍 ${esc(r.location)}</div>`:""}${r.note?`<div class="meta">${esc(r.note)}</div>`:""}${actions(r.id)}</article>`;
}
function formatDate(d){if(!d)return"";const p=String(d).split("-");return p.length===3?`${Number(p[0])}/${Number(p[1])}/${Number(p[2])}`:String(d)}
function formatRange(start,end){if(start&&end&&start!==end)return `${formatDate(start)} ～ ${formatDate(end)}`;return formatDate(start||end)}
function card(n,m,x,r){return `<article class="card"><div class="name">${n}</div>${m?`<div class="meta">${m}</div>`:""}${x?`<div>${x}</div>`:""}${r.note?`<div class="meta">${esc(r.note)}</div>`:""}${actions(r.id)}</article>`}
function actions(id){return `<div class="actions"><button class="edit" data-id="${id}">✎ 編輯</button><button class="del" data-id="${id}">🗑 刪除</button></div>`}
async function remove(id){if(!confirm("確定要刪除嗎？"))return;const {data:uData}=await db.auth.getUser();const u=uData.user;if(!u){alert("請先登入");return}const table=view==="todo"?"todos":view;const r=await db.from(table).delete().eq("id",id).eq("user_id",u.id);if(r.error){alert(r.error.message);return}await load()}

const field=(l,x)=>`<label>${l}${x}</label>`;
function fields(t,r={}){
  const end=`<div class="actions2"><button type="button" class="cancel" id="cancel">取消</button><button class="save">儲存</button></div>`;
  if(t==="food")return field("店家名稱",`<input name="name" required value="${esc(r.name)}">`)+field("分類",`<select name="category">${cats.food.map(x=>`<option ${x===(r.category||cat)?"selected":""}>${x}</option>`).join("")}</select>`)+field("捷運站",`<input name="mrt" value="${esc(r.mrt)}">`)+field("幾號出口",`<input name="exit" value="${esc(r.exit)}">`)+field("走幾分鐘",`<input name="walk_minutes" type="number" min="0" value="${r.walk_minutes??""}">`)+field("Google Maps",`<input name="maps_url" type="url" value="${esc(r.maps_url)}">`)+field("備註",`<textarea name="note">${esc(r.note)}</textarea>`)+end;
  if(t==="wishlist")return field("商品名稱",`<input name="name" required value="${esc(r.name)}">`)+field("地區",`<select name="country">${cats.wishlist.map(x=>`<option ${x===(r.country||cat)?"selected":""}>${x}</option>`).join("")}</select>`)+field("購買地點",`<input name="purchase_place" value="${esc(r.purchase_place)}">`)+field("備註",`<textarea name="note">${esc(r.note)}</textarea>`)+end;
  if(t==="watchlist")return field("劇名／電影名",`<input name="name" required value="${esc(r.name)}">`)+field("分類",`<select name="category">${cats.watchlist.map(x=>`<option ${x===(r.category||cat)?"selected":""}>${x}</option>`).join("")}</select>`)+end;
  const start=r.start_date||r.event_date||"",endDate=r.end_date||"";
  return field("類型",`<select name="event_type" id="todoType"><option ${((r.event_type||cat)==="提醒事項")?"selected":""}>提醒事項</option><option ${((r.event_type||cat)==="行程")?"selected":""}>行程</option></select>`)+field("名稱",`<input name="title" required value="${esc(r.title)}">`)+field("開始日期",`<input name="start_date" type="date" value="${esc(start)}">`)+field("結束日期",`<input name="end_date" type="date" value="${esc(endDate)}">`)+field("時間",`<input name="event_time" type="time" value="${esc(r.event_time)}">`)+field("地點",`<input name="location" value="${esc(r.location)}">`)+field("備註",`<textarea name="note">${esc(r.note)}</textarea>`)+end;
}
function openForm(t,r=null){editing=r;$("#fmsg").textContent="";$("#modal").classList.remove("hidden");$("#mtitle").textContent=r?"編輯":"新增";$("#form").innerHTML=fields(t,r||{});$("#cancel").onclick=close;$("#form").onsubmit=e=>save(e,t)}
function chooser(){$("#fmsg").textContent="";$("#modal").classList.remove("hidden");$("#mtitle").textContent="想新增什麼？";$("#form").innerHTML=`<div class="tiles"><button type="button" class="tile pink" data-new="food">🍽️ 食物</button><button type="button" class="tile purple" data-new="wishlist">🛍️ 想買</button><button type="button" class="tile blue" data-new="watchlist">🎬 影劇</button><button type="button" class="tile green" data-new="todo">🧩 生活管理</button></div>`;$$('[data-new]').forEach(b=>b.onclick=()=>openForm(b.dataset.new))}
function close(){$("#modal").classList.add("hidden");editing=null}
async function save(e,t){
  e.preventDefault();$("#fmsg").textContent="";const v=Object.fromEntries(new FormData(e.target).entries());
  const {data:uData}=await db.auth.getUser();const u=uData.user;if(!u){$("#fmsg").textContent="登入狀態已失效，請重新登入。";return}
  if(t==="food"&&v.walk_minutes==="")v.walk_minutes=null;
  if(t==="todo"){
    if(!v.end_date)v.end_date=null;
    if(v.start_date&&v.end_date&&v.end_date<v.start_date){$("#fmsg").textContent="結束日期不能早於開始日期。";return}
    v.done=editing?.done??false;
  }
  const table=t==="todo"?"todos":t;
  const r=editing?await db.from(table).update(v).eq("id",editing.id).eq("user_id",u.id):await db.from(table).insert({...v,user_id:u.id});
  if(r.error){$("#fmsg").textContent=r.error.message;return}
  close();if(view===t||(view==="todo"&&t==="todo"))await load();
}

async function loadUserName(){const {data,error}=await db.auth.getUser();const u=data.user;if(error||!u)return;let name=typeof u.user_metadata?.display_name==="string"?u.user_metadata.display_name.trim():"";if(!name){name="user";const r=await db.auth.updateUser({data:{display_name:name}});if(r.error)console.error(r.error)}$("#userName").textContent=name}
async function editUserName(){const {data}=await db.auth.getUser();const current=data.user?.user_metadata?.display_name||"user";const name=prompt("想顯示什麼名字？",current);if(name===null)return;const clean=name.trim().slice(0,30);if(!clean)return;const r=await db.auth.updateUser({data:{display_name:clean}});if(r.error){alert(r.error.message);return}$("#userName").textContent=clean}
$("#editName").onclick=editUserName;
db.auth.getSession().then(({data})=>data.session?showApp():showAuth());
db.auth.onAuthStateChange((_e,s)=>s?showApp():showAuth());
function showAuth(){$("#auth").classList.remove("hidden");$("#app").classList.add("hidden")}
function showApp(){$("#auth").classList.add("hidden");$("#app").classList.remove("hidden");loadUserName();home()}
