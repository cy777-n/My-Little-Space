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
let view="home",cat=null,editing=null,rows=[],register=false,attachmentsByItem={},groups=[],selectedScope="private",selectedGroupId=null,starredGroups=[],customCats={},groupOrder=[],currentUserId=null,folderViewId=null,wishlistFolders=[],saving=false,batchObjectUrls=[],batchEntries=[],pendingSave=null;

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
$("#addFolder").onclick=createWishlistFolder;
$("#batchAdd").onclick=()=>{if(localStorage.getItem("myLittleSpaceImageConsent")!=="yes"){const ok=confirm("圖片附件權限\n\n是否同意在你主動選擇照片後使用這些圖片？網站不會自行讀取整個相簿。");if(!ok)return;localStorage.setItem("myLittleSpaceImageConsent","yes")}const input=$("#batchImages");input.value="";input.click()};
$("#batchImages").onchange=e=>{const files=[...e.target.files||[]].filter(f=>f.type.startsWith("image/"));if(files.length)openBatchForm(files)};
$("#scopePicker").onchange=e=>selectScope(e.target.value);
$("#close").onclick=close;
$("#closePhoto").onclick=closePhoto;
$("#photoViewer").querySelector(".photo-shade").onclick=closePhoto;
document.addEventListener("keydown",e=>{if(e.key==="Escape")closePhoto()});

function home(){$("#home").classList.remove("hidden");$("#list").classList.add("hidden");view="home";folderViewId=null;$("#addFolder")?.classList.add("hidden");$("#batchAdd")?.classList.add("hidden");renderScopePicker()}

function openView(v){
  view=v;folderViewId=null;
  cat=v==="todo"?"提醒事項":v==="memo"?null:cats[v][0];
  $("#home").classList.add("hidden");
  $("#list").classList.remove("hidden");
  $("#title").textContent=areaTitle(v);
  $("#share").classList.add("hidden");
  $("#addFolder")?.classList.remove("hidden");
  $("#batchAdd")?.classList.remove("hidden");
  renderCats();
  load()
}
function catArea(){return view==="todo"?"todo":view==="memo"?"memo":view}
function catColumn(){return view==="todo"?"event_type":view==="wishlist"?"country":"category"}
function categoryScopeKey(){return selectedScope==="group"&&selectedGroupId?`group:${selectedGroupId}`:`user:${currentUserId||""}`}
function customCategoryList(){return customCats[categoryScopeKey()]?.[catArea()]||[]}
function allCategories(){return view==="memo"?[]:customCategoryList()}
function defaultCategoriesForArea(area){return area==="todo"?["提醒事項","行程"]:area==="memo"?[]:(cats[area]||[])}
function renderCats(){
  if(view==="memo"){ $("#cats").innerHTML=""; return; }
  const list=allCategories();
  $("#cats").innerHTML=list.map(c=>`<div class="cat-wrap"><button class="${c===cat?"active":""}" data-cat="${esc(c)}">${esc(c)}</button><button type="button" class="cat-remove" data-remove-cat="${esc(c)}" title="刪除分類" aria-label="刪除分類 ${esc(c)}">×</button></div>`).join("")+`<button type="button" class="cat-add" id="addCategory">＋ 類別</button>`;
  $$('[data-cat]').forEach(b=>b.onclick=()=>{cat=b.dataset.cat;folderViewId=null;renderCats();load()});
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
  for(const area of ["food","wishlist","watchlist","todo"]){
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
  const requestedView=view, requestedScope=selectedScope, requestedGroup=selectedGroupId, requestedCat=cat;
  const table=view==="todo"?"todos":view==="memo"?"memos":view;
  const {data:uData}=await db.auth.getUser(),u=uData.user;
  if(!u)return;
  await loadGroups();
  if(requestedView!==view||requestedScope!==selectedScope||requestedGroup!==selectedGroupId)return;
  renderScopePicker();
  await loadCategories();
  if(requestedView!==view||requestedScope!==selectedScope||requestedGroup!==selectedGroupId)return;
  if(view==="memo")cat=null;
  else if(!allCategories().includes(cat))cat=allCategories()[0]||"";
  renderCats();
  let q=db.from(table).select("*");
  if(selectedScope==="group"&&selectedGroupId)q=q.eq("share_group_id",selectedGroupId);
  else q=q.eq("user_id",u.id).is("share_group_id",null);
  if(view!=="memo"&&cat)q=q.eq(filterColumn(),cat);
  if(folderViewId)q=q.eq("folder_id",folderViewId);else q=q.is("folder_id",null);
  const r=await q.order("sort_order",{ascending:true}).order("created_at",{ascending:false});
  if(r.error){console.error(r.error);$("#cards").innerHTML=`<p class="meta">${esc(r.error.message)}<br>如果是購物資料夾功能第一次使用，請先執行 v31 的 Supabase SQL。</p>`;return}
  if(requestedView!==view||requestedScope!==selectedScope||requestedGroup!==selectedGroupId)return;
  rows=r.data||[];
  if(rows.length&&new Set(rows.map(x=>Number(x.sort_order)||0)).size!==rows.length){
    for(let i=0;i<rows.length;i++){let oq=db.from(table).update({sort_order:i}).eq("id",rows[i].id);if(selectedScope==="private")oq=oq.is("share_group_id",null);else oq=oq.eq("share_group_id",selectedGroupId);const or=await oq;if(or.error){console.error(or.error);break}rows[i].sort_order=i}
  }
  attachmentsByItem={};
  if(rows.length){
    const ar=await db.from("attachments").select("*").eq("item_type",view).in("item_id",rows.map(x=>String(x.id)));
    if(!ar.error)(ar.data||[]).forEach(a=>(attachmentsByItem[String(a.item_id)]??=[]).push(a));
  }
  await loadWishlistFolders();
  const folderMarkup=!folderViewId?wishlistFolders.map(renderWishlistFolder).join(""):"";
  const backMarkup=folderViewId?`<div class="folder-backbar"><button type="button" id="folderBack" class="gray">← 所有項目</button><span>📁 ${esc(wishlistFolders.find(f=>f.id===folderViewId)?.name||"資料夾")}</span></div>`:"";
  $("#folderToolbar").innerHTML=backMarkup;
  $("#cards").innerHTML=folderMarkup+rows.map(renderRow).join("");
  $("#folderBack")?.addEventListener("click",()=>{folderViewId=null;load()});
  $$(".edit").forEach(b=>b.onclick=()=>openForm(view,rows.find(x=>String(x.id)===String(b.dataset.id))));
  $$(".del").forEach(b=>b.onclick=()=>remove(b.dataset.id));
  $$('[data-check]').forEach(b=>b.onchange=async()=>{const rr=await db.from("todos").update({done:b.checked}).eq("id",b.dataset.check);if(rr.error)alert(rr.error.message);await load()});
  $$('[data-attachment-delete]').forEach(b=>b.onclick=()=>removeAttachment(b.dataset.attachmentDelete,b.dataset.path));
  $$('[data-photo-url]').forEach(b=>b.onclick=()=>openPhoto(b.dataset.photoUrl,b.dataset.photoName));
  wireWishlistDnD();$$("[data-move-root]").forEach(b=>b.onclick=()=>moveWishlistItem(b.dataset.moveRoot,null));
}
async function loadWishlistFolders(){
  let q=db.from("wishlist_folders").select("id,name,note,sort_order,user_id,share_group_id,area").eq("area",view);
  if(selectedScope==="group"&&selectedGroupId)q=q.eq("share_group_id",selectedGroupId);
  else q=q.eq("user_id",currentUserId).is("share_group_id",null);
  if(cat)q=q.eq("category",cat);
  const r=await q.order("sort_order",{ascending:true}).order("created_at",{ascending:true});
  if(r.error){wishlistFolders=[];console.error(r.error);return}
  wishlistFolders=r.data||[];
}
function renderWishlistFolder(f){
  const countLabel="📁 資料夾";
  return `<article class="card folder-card" draggable="true" data-folder-card="${esc(f.id)}"><button type="button" class="folder-open" data-open-folder="${esc(f.id)}"><span class="folder-icon">📁</span><span class="folder-name">${esc(f.name)}</span><span class="folder-sub">${countLabel}</span>${f.note?`<span class="folder-note">${esc(f.note)}</span>`:""}</button><div class="actions"><button type="button" class="folder-rename" data-rename-folder="${esc(f.id)}">✎ 編輯</button><button type="button" class="del folder-delete" data-delete-folder="${esc(f.id)}">🗑 刪除</button></div></article>`;
}
async function createWishlistFolder(){
  openFolderForm();
}
async function renameWishlistFolder(id){
  const f=wishlistFolders.find(x=>x.id===id);if(!f)return;openFolderForm(f);
}
function openFolderForm(folder=null){
  const form=$("#form");
  $("#modal").classList.remove("hidden");
  $("#mtitle").textContent=folder?"編輯資料夾":"新增資料夾";
  form.innerHTML=`<label>資料夾名稱<input name="folder_name" maxlength="40" required placeholder="請輸入資料夾名稱" value="${esc(folder?.name||"")}"></label><label>備註／地點<textarea name="folder_note" placeholder="可填寫店家地址、地點或其他提醒">${esc(folder?.note||"")}</textarea></label><div class="actions2"><button type="button" class="cancel" id="folderCancel">取消</button><button type="submit" class="save">${folder?"儲存修改":"建立資料夾"}</button></div>`;
  $("#fmsg").textContent="";$("#folderCancel").onclick=close;
  form.onsubmit=async e=>{e.preventDefault();if(saving)return;const saveScope=selectedScope,saveGroupId=selectedGroupId;const fd=new FormData(form),name=String(fd.get("folder_name")||"").trim().slice(0,40),note=String(fd.get("folder_note")||"").trim();if(!name){$("#fmsg").textContent="請先輸入資料夾名稱。";return}if(wishlistFolders.some(f=>f.name.toLowerCase()===name.toLowerCase()&&f.id!==folder?.id)){$("#fmsg").textContent="這個資料夾名稱已經存在。";return}saving=true;const btn=form.querySelector(".save");btn.disabled=true;btn.textContent="儲存中…";
    let result;
    if(folder){let q=db.from("wishlist_folders").update({name,note}).eq("id",folder.id);if(saveScope==="private")q=q.is("share_group_id",null);else q=q.eq("share_group_id",saveGroupId);result=await q}
    else{const {data}=await db.auth.getUser(),u=data.user;if(!u){saving=false;btn.disabled=false;$("#fmsg").textContent="登入狀態已失效，請重新登入。";return}result=await db.from("wishlist_folders").insert({user_id:u.id,share_group_id:saveScope==="group"?saveGroupId:null,name,note,category:cat||"全部",area:view,sort_order:wishlistFolders.length})}
    saving=false;if(result.error){btn.disabled=false;btn.textContent=folder?"儲存修改":"建立資料夾";$("#fmsg").textContent=`儲存失敗：${result.error.message}`;return}close();await load();
  };
}
async function deleteWishlistFolder(id){
  const f=wishlistFolders.find(x=>x.id===id);if(!f)return;
  if(!await askConfirm(`確定刪除「${f.name}」資料夾嗎？裡面的項目會移回原本分類，不會被刪除。`))return;
  const table=view==="todo"?"todos":view==="memo"?"memos":view;
  let move=db.from(table).update({folder_id:null}).eq("folder_id",id);
  if(selectedScope==="private")move=move.is("share_group_id",null);else move=move.eq("share_group_id",selectedGroupId);
  const mr=await move;if(mr.error){alert(mr.error.message);return}
  const r=await db.from("wishlist_folders").delete().eq("id",id);if(r.error){alert(r.error.message);return}await load();
}
async function moveWishlistItem(id,folderId){
  const table=view==="todo"?"todos":view==="memo"?"memos":view;
  let q=db.from(table).update({folder_id:folderId,sort_order:Date.now()}).eq("id",id);
  if(selectedScope==="private")q=q.is("share_group_id",null);else q=q.eq("share_group_id",selectedGroupId);
  const r=await q;if(r.error){alert(r.error.message);return}await load();
}
function wireWishlistDnD(){
  $$('[data-open-folder]').forEach(b=>b.onclick=()=>{folderViewId=b.dataset.openFolder;load()});
  $$('[data-rename-folder]').forEach(b=>b.onclick=()=>renameWishlistFolder(b.dataset.renameFolder));
  $$('[data-delete-folder]').forEach(b=>b.onclick=()=>deleteWishlistFolder(b.dataset.deleteFolder));

  let draggedItem=null,draggedFolder=null;
  const clearDragState=()=>{
    $$('#cards .dragging, #cards .drag-over').forEach(el=>el.classList.remove('dragging','drag-over'));
    draggedItem=null;draggedFolder=null;
  };

  // Cards: explicitly set dataTransfer data so native drag works consistently in Safari/Chrome.
  $$('#cards article.card[data-id]').forEach(el=>{
    el.draggable=true;
    el.classList.add('sortable-card');
    el.ondragstart=e=>{
      draggedItem=String(el.dataset.id);
      draggedFolder=null;
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain',`item:${draggedItem}`);
      el.classList.add('dragging');
    };
    el.ondragend=clearDragState;
    el.ondragover=e=>{
      if(!draggedItem||draggedItem===String(el.dataset.id))return;
      e.preventDefault();
      e.dataTransfer.dropEffect='move';
      el.classList.add('drag-over');
    };
    el.ondragleave=e=>{
      if(!el.contains(e.relatedTarget))el.classList.remove('drag-over');
    };
    el.ondrop=async e=>{
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drag-over');
      const target=String(el.dataset.id);
      if(!draggedItem||draggedItem===target)return;
      const arr=[...rows];
      const a=arr.findIndex(x=>String(x.id)===draggedItem);
      const b=arr.findIndex(x=>String(x.id)===target);
      if(a<0||b<0)return;
      const [item]=arr.splice(a,1);
      arr.splice(b,0,item);
      clearDragState();
      await persistWishlistOrder(arr);
    };
  });

  // Folders: accept dropped cards, or reorder folders with other folders.
  $$('[data-folder-card]').forEach(el=>{
    el.ondragover=e=>{
      if(!draggedItem&&!draggedFolder)return;
      e.preventDefault();
      e.dataTransfer.dropEffect='move';
      el.classList.add('drag-over');
    };
    el.ondragleave=e=>{
      if(!el.contains(e.relatedTarget))el.classList.remove('drag-over');
    };
    el.ondrop=async e=>{
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drag-over');
      if(draggedItem){
        const itemId=draggedItem;
        clearDragState();
        await moveWishlistItem(itemId,el.dataset.folderCard);
        return;
      }
      if(draggedFolder&&draggedFolder!==el.dataset.folderCard){
        const arr=[...wishlistFolders];
        const a=arr.findIndex(x=>String(x.id)===String(draggedFolder));
        const b=arr.findIndex(x=>String(x.id)===String(el.dataset.folderCard));
        if(a<0||b<0)return;
        const [folder]=arr.splice(a,1);
        arr.splice(b,0,folder);
        for(let i=0;i<arr.length;i++){
          let q=db.from('wishlist_folders').update({sort_order:i}).eq('id',arr[i].id);
          if(selectedScope==='private')q=q.is('share_group_id',null);else q=q.eq('share_group_id',selectedGroupId);
          const result=await q;
          if(result.error){alert(result.error.message);return;}
        }
        clearDragState();
        await load();
      }
    };
    el.draggable=true;
    el.ondragstart=e=>{
      if(draggedItem){e.preventDefault();return;}
      draggedFolder=String(el.dataset.folderCard);
      draggedItem=null;
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain',`folder:${draggedFolder}`);
      el.classList.add('dragging');
    };
    el.ondragend=clearDragState;
  });
}
async function persistWishlistOrder(arr){
  const table=view==="todo"?"todos":view==="memo"?"memos":view;
  for(let i=0;i<arr.length;i++){let q=db.from(table).update({sort_order:i}).eq("id",arr[i].id);if(selectedScope==="private")q=q.is("share_group_id",null);else q=q.eq("share_group_id",selectedGroupId);const r=await q;if(r.error){alert(r.error.message);return}}
  await load();
}

function renderRow(r){
  const att=attachmentsHtml(r.id);
  if(view==="food")return card(`🍽️ ${esc(r.name)}`,`${r.mrt?`🚇 ${esc(r.mrt)} `:""}${r.exit?`🚪 ${esc(r.exit)}號出口 `:""}${r.walk_minutes!=null?`🚶🏻‍♀️ ${r.walk_minutes} 分鐘`:""}`,safeUrl(r.maps_url)?`<a class="meta" href="${esc(safeUrl(r.maps_url))}" target="_blank" rel="noopener">🗺️ Google Maps</a>`:"",r,att);
  if(view==="wishlist")return `<article class="card" data-id="${esc(r.id)}"><div class="name">🛍️ ${esc(r.name)}</div>${r.purchase_place?`<div class="meta">📍 ${esc(r.purchase_place)}</div>`:""}${r.note?`<div class="meta">${esc(r.note)}</div>`:""}${att}${folderViewId?`<div class="actions"><button type="button" class="move-root" data-move-root="${esc(r.id)}">↩ 移出資料夾</button>${actions(r.id)}</div>`:actions(r.id)}</article>`;
  if(view==="watchlist")return card(`✦ ${esc(r.name)}`,"","",r,att);
  if(view==="memo")return `<article class="card" data-id="${esc(r.id)}"><div class="name">📝 ${esc(r.title||"未命名備忘錄")}${scopeBadge(r)}</div>${r.content?`<div class="memo-content">${esc(r.content).replace(/\n/g,"<br>")}</div>`:""}${memoUrlsHtml(r.urls)}${tableHtml(r.table_data)}${att}${folderViewId?`<div class="actions"><button type="button" class="move-root" data-move-root="${esc(r.id)}">↩ 移出資料夾</button>${actions(r.id)}</div>`:actions(r.id)}</article>`;
  const range=formatRange(r.start_date||r.event_date,r.end_date);
  return `<article class="card" data-id="${esc(r.id)}"><div class="name"><input type="checkbox" data-check="${r.id}" ${r.done?"checked":""}> ${esc(r.title)}${scopeBadge(r)}</div>${range?`<div class="meta">📅 ${esc(range)}${r.event_time?` ⏰ ${esc(r.event_time)}`:""}</div>`:""}${r.location?`<div class="meta">📍 ${esc(r.location)}</div>`:""}${r.note?`<div class="meta">${esc(r.note)}</div>`:""}${att}${folderViewId?`<div class="actions"><button type="button" class="move-root" data-move-root="${esc(r.id)}">↩ 移出資料夾</button>${actions(r.id)}</div>`:actions(r.id)}</article>`;
}
function formatDate(d){if(!d)return"";const p=String(d).split("-");return p.length===3?`${Number(p[0])}/${Number(p[1])}/${Number(p[2])}`:String(d)}
function formatRange(start,end){if(start&&end&&start!==end)return `${formatDate(start)} ～ ${formatDate(end)}`;return formatDate(start||end)}
function scopeBadge(r){return ""}
function card(n,m,x,r,att=""){return `<article class="card" data-id="${esc(r.id)}"><div class="name">${n}${scopeBadge(r)}</div>${m?`<div class="meta">${m}</div>`:""}${x?`<div>${x}</div>`:""}${r.note?`<div class="meta">${esc(r.note)}</div>`:""}${att}${folderViewId?`<div class="actions"><button type="button" class="move-root" data-move-root="${esc(r.id)}">↩ 移出資料夾</button>${actions(r.id)}</div>`:actions(r.id)}</article>`}
function actions(id){return `<div class="actions"><button class="edit" data-id="${esc(id)}">✎ 編輯</button><button class="del" data-id="${esc(id)}">🗑 刪除</button></div>`}

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
  const isGroupScope=selectedScope==="group"&&!!selectedGroupId;
  const sorted=sortedGroupsList();
  el.innerHTML=`<button type="button" class="scope-current"><span>${isGroupScope?"👥":"👤"} ${esc(isGroupScope?(current?.name||"群組") : "個人")}</span><span class="scope-chevron">⌄</span></button><div class="scope-menu hidden"><button type="button" class="scope-option ${!isGroupScope?"active":""}" data-scope="private"><span>👤 個人</span></button>${sorted.map(g=>`<div class="scope-option-wrap"><button type="button" class="scope-option ${current?.id===g.id?"active":""}" data-scope="group:${esc(g.id)}"><span>${starredGroups.includes(g.id)?"⭐":"👥"} ${esc(g.name)}</span></button><button type="button" class="scope-star ${starredGroups.includes(g.id)?"starred":""}" data-star-id="${esc(g.id)}" title="${starredGroups.includes(g.id)?"取消標記":"標記"}">${starredGroups.includes(g.id)?"★":"☆"}</button></div>`).join("")}</div>`;
  $(".scope-current",el).onclick=()=>$(".scope-menu",el).classList.toggle("hidden");
  $$(".scope-option",el).forEach(b=>b.onclick=()=>selectScope(b.dataset.scope));
  $$(".scope-star",el).forEach(b=>b.onclick=e=>{e.stopPropagation();toggleStarGroup(b.dataset.starId)});
  $("#groupManage").onclick=shareManager;
}
function selectScope(value){
  if(saving||!$("#modal").classList.contains("hidden"))return;
  if(value==="private"){selectedScope="private";selectedGroupId=null;}
  else{selectedScope="group";selectedGroupId=value.slice(6);}
  renderScopePicker();
  const menu=$(".scope-menu");if(menu)menu.classList.add("hidden");
  if(view!=="home"){$("#title").textContent=areaTitle(view);load();}
}

function attachmentField(){
  return `<div class="attachment-field"><label>📎 圖片附件</label><button type="button" id="allowImages" class="consent-btn">先同意使用圖片，再選擇圖片</button><input id="imageFiles" name="imageFiles" type="file" accept="image/*" multiple hidden><div id="imageSelectionStatus" class="image-selection-status" aria-live="polite">尚未選取新圖片</div><div id="imageSelectionList" class="image-selection-list"></div><small>你可以一次選擇多張圖片。網站不會自動讀取你的整個相簿，只有你在系統選擇並確認的圖片才會被上傳。</small></div>`
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
    input.onchange=()=>{const files=[...input.files||[]];const status=$("#imageSelectionStatus"),list=$("#imageSelectionList");if(!files.length){status.textContent="尚未選取新圖片";status.classList.remove("selected");list.innerHTML="";return}status.textContent=`✓ 已選取 ${files.length} 張圖片，儲存時會一併上傳`;status.classList.add("selected");list.innerHTML=files.map(f=>`<span>📷 ${esc(f.name)}</span>`).join("");};
  }
}
function batchField(label,name,value="",type="text",placeholder=""){
  return `<label class="batch-label">${label}<input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`;
}
function batchFieldsFor(t,i){
  const p=`b${i}-`;
  if(t==="food")return batchField("店家名稱＊",p+"name")+batchField("捷運站",p+"mrt")+batchField("出口",p+"exit")+batchField("步行分鐘",p+"walk_minutes","","number")+batchField("Google Maps",p+"maps_url","","url")+`<label class="batch-label">備註<textarea name="${p}note"></textarea></label>`;
  if(t==="wishlist")return batchField("商品名稱＊",p+"name")+batchField("購買地點",p+"purchase_place")+`<label class="batch-label">備註<textarea name="${p}note"></textarea></label>`;
  if(t==="watchlist")return batchField("劇名／電影名＊",p+"name");
  if(t==="todo")return batchField("名稱＊",p+"title")+batchField("開始日期",p+"start_date","","date")+batchField("結束日期",p+"end_date","","date")+batchField("時間",p+"event_time","","time")+batchField("地點",p+"location")+`<label class="batch-label">備註<textarea name="${p}note"></textarea></label>`;
  return batchField("標題＊",p+"title")+`<label class="batch-label">內容<textarea name="${p}content"></textarea></label>`+`<label class="batch-label">其他網址<textarea name="${p}urls" placeholder="一行一個網址"></textarea></label>`;
}
function clearBatchState(){batchObjectUrls.forEach(URL.revokeObjectURL);batchObjectUrls=[];batchEntries=[]}
function openBatchForm(files){
  clearBatchState();batchEntries=files.map(file=>({file,objectUrl:URL.createObjectURL(file),recordId:null,recordSaved:false,uploaded:false,status:"待儲存"}));batchObjectUrls=batchEntries.map(x=>x.objectUrl);
  const cards=batchEntries.map((entry,i)=>`<section class="batch-photo-card" data-batch-card="${i}"><div class="batch-photo-head"><img src="${entry.objectUrl}" alt=""><div><b>照片 ${i+1}</b><small>${esc(entry.file.name)}</small><span class="batch-status" data-batch-status="${i}">待儲存</span></div></div><div class="batch-fields">${batchFieldsFor(view,i)}</div></section>`).join("");
  const categoryField=view==="food"?field("分類",`<select name="batch_category">${allCategories().map(x=>`<option ${x===cat?"selected":""}>${esc(x)}</option>`).join("")}</select>`):view==="wishlist"?field("地區",`<select name="batch_country">${allCategories().map(x=>`<option ${x===cat?"selected":""}>${esc(x)}</option>`).join("")}</select>`):view==="watchlist"?field("分類",`<select name="batch_category">${allCategories().map(x=>`<option ${x===cat?"selected":""}>${esc(x)}</option>`).join("")}</select>`):view==="todo"?field("類型",`<select name="batch_event_type">${allCategories().map(x=>`<option ${x===cat?"selected":""}>${esc(x)}</option>`).join("")}</select>`):"";
  editing=null;$("#modal").classList.remove("hidden");$("#mtitle").textContent=`批次新增｜${files.length} 張照片`;
  $("#form").innerHTML=`<p class="batch-intro">每張照片各自建立一筆資料。先填寫有＊的名稱，再按全部儲存；若中途失敗，可以直接重試，已成功的項目不會重複新增。</p>${categoryField}<div class="batch-progress" id="batchProgress">尚未開始儲存</div><div class="batch-photo-list">${cards}</div><div class="actions2"><button type="button" class="cancel" id="cancel">取消</button><button type="submit" class="save">全部儲存</button></div>`;
  $("#cancel").onclick=close;$("#form").onsubmit=e=>saveBatch(e);
  $("#form").addEventListener("input",e=>e.target.closest(".batch-photo-card")?.classList.remove("batch-invalid"));
}
function setBatchStatus(i,status,kind="") {const el=$(`[data-batch-status="${i}"]`);if(el){el.textContent=status;el.className=`batch-status ${kind}`}}
async function saveBatch(e){
  e.preventDefault();if(localStorage.getItem("myLittleSpaceImageConsent")!=="yes"){$("#fmsg").textContent="請先同意使用圖片附件。";return}if(saving)return;
  const saveScope=selectedScope,saveGroupId=selectedGroupId,saveFolderId=folderViewId;
  const form=$("#form"),fd=new FormData(form),btn=form.querySelector(".save"),table=view==="todo"?"todos":view==="memo"?"memos":view,area=view;
  // Validate every required title before writing anything, avoiding silent skips.
  const missing=[];batchEntries.forEach((entry,i)=>{const key=view==="todo"||view==="memo"?"title":"name";const value=String(fd.get(`b${i}-${key}`)||"").trim();if(!entry.recordSaved&&!value)missing.push(i+1)});
  if(missing.length){missing.forEach(n=>{const card=$(`[data-batch-card="${n-1}"]`);card?.classList.add("batch-invalid")});$("#fmsg").textContent=`請先補上第 ${missing.join("、")} 張照片的名稱（＊）。尚未開始儲存。`;return}
  saving=true;btn.disabled=true;btn.textContent="儲存中…";$("#fmsg").textContent="";const progress=$("#batchProgress");
  try{
    const {data:uData}=await db.auth.getUser(),u=uData.user;if(!u)throw new Error("登入狀態已失效，請重新登入。");
    let completed=0;for(let i=0;i<batchEntries.length;i++){
      const entry=batchEntries[i];if(entry.uploaded){completed++;continue}
      setBatchStatus(i,"處理中…","working");progress.textContent=`正在處理 ${i+1}/${batchEntries.length} 張照片`;
      const get=k=>String(fd.get(`b${i}-${k}`)||"").trim();let v={user_id:u.id,share_group_id:saveScope==="group"?saveGroupId:null,folder_id:saveFolderId||null,sort_order:Date.now()+i};
      if(view==="food")Object.assign(v,{name:get("name"),category:fd.get("batch_category")||cat,mrt:get("mrt"),exit:get("exit"),walk_minutes:get("walk_minutes")?Number(get("walk_minutes")):null,maps_url:get("maps_url"),note:get("note")});
      if(view==="wishlist")Object.assign(v,{name:get("name"),country:fd.get("batch_country")||cat,purchase_place:get("purchase_place"),note:get("note")});
      if(view==="watchlist")Object.assign(v,{name:get("name"),category:fd.get("batch_category")||cat});
      if(view==="todo")Object.assign(v,{title:get("title"),event_type:fd.get("batch_event_type")||cat,start_date:get("start_date")||null,end_date:get("end_date")||null,event_time:get("event_time")||null,location:get("location"),note:get("note"),done:false});
      if(view==="memo")Object.assign(v,{title:get("title"),content:get("content"),urls:get("urls"),category:null,table_data:null});
      if(!entry.recordSaved){const ins=await db.from(table).insert(v).select().single();if(ins.error){setBatchStatus(i,"資料儲存失敗","failed");throw new Error(`第 ${i+1} 張資料儲存失敗：${ins.error.message}`)}entry.recordId=ins.data.id;entry.recordSaved=true;}
      try{await uploadSingleAttachment(area,entry.recordId,u.id,entry.file);entry.uploaded=true;entry.status="完成";setBatchStatus(i,"✓ 完成","done")}catch(err){setBatchStatus(i,"圖片上傳失敗，可重試","failed");throw new Error(`第 ${i+1} 張資料已建立，但圖片上傳失敗：${err.message||err}`)}
      completed++;progress.textContent=`已完成 ${completed}/${batchEntries.length} 張照片`;
    }
    progress.textContent=`✓ 全部完成，共 ${batchEntries.length} 筆資料`;close();clearBatchState();await load();
  }catch(err){$("#fmsg").textContent=err.message||String(err);progress.textContent="部分項目已完成；可直接再次按「全部儲存」繼續，不會重複建立已完成資料。"}
  finally{saving=false;const current=$("#form .save");if(current){current.disabled=false;current.textContent="重新儲存未完成項目"}}
}

function chooser(){
  $("#fmsg").textContent="";
  $("#modal").classList.remove("hidden");
  $("#mtitle").textContent="想新增什麼？";
  $("#form").innerHTML=`<div class="tiles"><button type="button" class="tile pink" data-new="food">🍽️ 食物</button><button type="button" class="tile purple" data-new="wishlist">🛍️ 購物</button><button type="button" class="tile blue" data-new="watchlist">🎬 影劇</button><button type="button" class="tile green" data-new="todo">🧩 生活管理</button><button type="button" class="tile memo-tile" data-new="memo">📝 備忘錄</button></div>`;
  $$('[data-new]').forEach(b=>b.onclick=()=>openForm(b.dataset.new))
}
function close(){$("#modal").classList.add("hidden");editing=null;pendingSave=null;if(batchEntries.length)clearBatchState()}
function askConfirm(message,yesText="是",noText="否"){return new Promise(resolve=>{const m=$("#confirmModal");if(!m){resolve(false);return}$("#confirmText").textContent=message;$("#confirmYes").textContent=yesText;$("#confirmNo").textContent=noText;m.classList.remove("hidden");const done=v=>{m.classList.add("hidden");$("#confirmYes").onclick=null;$("#confirmNo").onclick=null;resolve(v)};$("#confirmYes").onclick=()=>done(true);$("#confirmNo").onclick=()=>done(false)})}

async function loadGroups(){
  const {data:uData}=await db.auth.getUser(),u=uData.user;if(!u)return;
  currentUserId=u.id;
  await loadStarredGroups();
  const r=await db.from("share_group_members").select("group_id, share_groups(id,name,owner_id)").eq("user_id",u.id);
  // A temporary network/RLS error must not make the active group appear to be Personal.
  if(r.error){console.error("loadGroups failed; keeping previous group list",r.error);return;}
  groups=(r.data||[]).map(x=>x.share_groups).filter(Boolean);
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


async function uploadSingleAttachment(t,itemId,userId,file){
  if(!file||!file.type.startsWith("image/"))return;
  const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,8)||"jpg";
  const path=`${userId}/${t}/${itemId}/${crypto.randomUUID()}.${ext}`;
  const up=await db.storage.from(ATTACH_BUCKET).upload(path,file,{upsert:false,contentType:file.type});if(up.error)throw up.error;
  const pub=db.storage.from(ATTACH_BUCKET).getPublicUrl(path);
  const ins=await db.from("attachments").insert({user_id:userId,item_type:t,item_id:String(itemId),file_name:file.name,storage_path:path,public_url:pub.data.publicUrl});if(ins.error){await db.storage.from(ATTACH_BUCKET).remove([path]);throw ins.error;}
}

async function uploadAttachments(t,itemId,userId,input){
  const files=[...(input?.files||[])];
  if(!files.length)return;
  if(localStorage.getItem("myLittleSpaceImageConsent")!=="yes"){
    throw new Error("請先同意使用圖片附件。")
  }
  for(const file of files){
    if(!file.type.startsWith("image/"))continue;
    await uploadSingleAttachment(t,itemId,userId,file);
  }
}

async function save(e,t){
  e.preventDefault();if(saving)return;const saveScope=selectedScope,saveGroupId=selectedGroupId,saveFolderId=folderViewId;saving=true;const form=$("#form"),saveButton=form.querySelector(".save");if(saveButton){saveButton.disabled=true;saveButton.textContent="儲存中…"}$("#fmsg").textContent="";
  try{
    const v=Object.fromEntries(new FormData(e.target).entries());
    const {data:uData,error:authError}=await db.auth.getUser(),u=uData.user;if(authError||!u)throw new Error("登入狀態已失效，請重新登入。");
    delete v.imageFiles;delete v.share_group_id;v.share_group_id=saveScope==="group"?saveGroupId:null;
    v.folder_id=editing?.folder_id??saveFolderId??null;if(!editing&&!pendingSave)v.sort_order=Date.now();
    if(t==="food"&&v.walk_minutes==="")v.walk_minutes=null;
    if(t==="todo"){
      if(!v.start_date)v.start_date=null;if(!v.end_date)v.end_date=null;if(!v.event_time)v.event_time=null;
      if(v.start_date&&v.end_date&&v.end_date<v.start_date)throw new Error("結束日期不能早於開始日期。");v.done=editing?.done??false;
    }
    if(t==="memo"){v.category=null;v.table_data=JSON.stringify(readTable());if(v.table_data==="null")v.table_data=null;}
    const table=t==="todo"?"todos":t==="memo"?"memos":t;
    let itemId=editing?.id||pendingSave?.itemId;
    if(editing||pendingSave){let q=db.from(table).update(v).eq("id",itemId);if(saveScope==="private")q=q.eq("user_id",u.id).is("share_group_id",null);else q=q.eq("share_group_id",saveGroupId);const r=await q;if(r.error)throw r.error;if(!pendingSave)pendingSave={itemId,table,uploadedKeys:[]};}
    else{const r=await db.from(table).insert({...v,user_id:u.id}).select().single();if(r.error)throw r.error;itemId=r.data.id;pendingSave={itemId,table,uploadedKeys:[]};}
    const files=[...($("#imageFiles")?.files||[])];for(const file of files){const key=[file.name,file.size,file.lastModified,file.type].join("|");if(pendingSave.uploadedKeys.includes(key))continue;try{await uploadSingleAttachment(t,itemId,u.id,file);pendingSave.uploadedKeys.push(key)}catch(err){throw new Error("資料已儲存，但圖片附件上傳失敗："+(err.message||err)+"。可直接重試，已成功上傳的照片不會重複附加。")}}
    pendingSave=null;close();if(view===t){if(folderViewId&&v.folder_id==null)folderViewId=null;await load();}
  }catch(err){$("#fmsg").textContent=err.message||String(err);}
  finally{saving=false;const b=$("#form .save");if(b){b.disabled=false;b.textContent=pendingSave?"重試儲存／上傳":"儲存"}}
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
db.auth.onAuthStateChange((event,s)=>{if(s){if($("#app").classList.contains("hidden"))showApp()}else if(event==="SIGNED_OUT")showAuth()});
function showAuth(){$("#auth").classList.remove("hidden");$("#app").classList.add("hidden")}
async function showApp(){$("#auth").classList.add("hidden");$("#app").classList.remove("hidden");loadUserName();await loadGroups();home()}
