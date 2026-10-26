import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const output='/tmp/dbx-13459-evidence';
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=await browser.newContext({viewport:{width:1440,height:950},deviceScaleFactor:1,locale:'zh-CN'});
const page=await context.newPage();
const config={id:'issue-13459-demo',name:'北方 · 搜索回归验证',db_type:'mysql',driver_label:'MySQL',host:'demo.invalid',port:3306,username:'demo',password:'fixture-only',database:'',color:'#059669'};
const databases=['erp_base','erp_charge_100004','erp_charge_100018','erp_charge_100019','erp_charge_100031','erp_charge_100036'];
const cache=new Map();
const calls=[];
const errors=[];
page.on('pageerror',error=>{errors.push(error.message);console.log('PAGEERROR',error.stack)});
await page.addInitScript(()=>{
  localStorage.setItem('dbx-app-state:editor_settings',JSON.stringify({sidebarSearchOpenedDatabasesOnly:true,sidebarGlobalSearchLocal:false,sidebarObjectDisplay:'grouped',sidebarBrowseObjectsOnDatabaseActivation:false,language:'zh-CN'}));
});
await page.route('**/api/**',async route=>{
  const request=route.request();
  const url=new URL(request.url());
  const p=url.pathname;
  const method=request.method();
  let body={};try{body=request.postDataJSON()??{}}catch{}
  calls.push({path:p,method,query:Object.fromEntries(url.searchParams),body});
  let result=[];
  if(p==='/api/auth/check')result={required:false,authenticated:true,setup_required:false};
  else if(p==='/api/migration/status')result={state:'not_required',needsMigration:false,keyRecoveryRequired:false};
  else if(p.includes('capabilities'))result={passwordViewerEnabled:false};
  else if(p==='/api/connection/list')result=[config];
  else if(p==='/api/connection/connect')result=config.id;
  else if(p==='/api/connection/database-info')result={db_type:'mysql',server_version:'8.0.40',version:'8.0.40',database:'',current_database:'',databases};
  else if(p==='/api/connection/is-open')result=true;
  else if(p==='/api/connection/session-credential-status')result=false;
  else if(p==='/api/connection/write-unlock/state')result={remainingMs:0};
  else if(p==='/api/saved-sql')result={folders:[],files:[]};
  else if(p==='/api/version')result='0.6.55';
  else if(p==='/api/prompt-templates/global-instructions')result='';
  else if(p==='/api/layout/sidebar')result=null;
  else if(p==='/api/layout/table-vgroups')result={};
  else if(p==='/api/schema/databases'||p==='/api/schema/database-metadata')result=databases.map(name=>({name}));
  else if(p==='/api/schema/cache'){
    if(method==='POST'){cache.set(body.cacheKey,body.payload);result=null}
    else result=cache.get(url.searchParams.get('cache_key'))??null;
  }
  else if(p==='/api/schema/tables'){
    const type=url.searchParams.get('object_types');
    const filter=url.searchParams.get('filter');
    const offset=Number(url.searchParams.get('offset')??0);
    const entries=Array.from({length:105},(_,i)=>({name:i===104?'zz_late_orders':`orders_${String(i).padStart(3,'0')}`,table_type:'TABLE',comment:i===104?'搜索中打开数据库后仍可命中完整索引':'演示订单表'}));
    result=type&&!type.includes('TABLE')?[]:entries.filter(e=>!filter||e.name.includes(filter)).slice(offset,offset+Number(url.searchParams.get('limit')??1000));
  }
  else if(p==='/api/schema/objects')result=[];
  else if(p.endsWith('events'))return route.fulfill({status:200,contentType:'text/event-stream',body:': fixture\n\n'});
  else if(method!=='GET')result=null;
  console.log(method,p,p.includes('/schema/')?url.search:'');
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
});
try {
  await page.goto('http://127.0.0.1:5179/',{waitUntil:'networkidle',timeout:120000});
  const row=id=>page.locator(`[data-node-id="${id}"]`).first();
  const toggle=async id=>{ await row(id).locator('button').first().click(); await page.waitForTimeout(650); };
  const state=()=>page.evaluate(async()=>{
    const { useConnectionStore }=await import('/src/stores/connectionStore.ts');
    const store=useConnectionStore();
    const root=store.treeNodes.find(n=>n.connectionId==='issue-13459-demo');
    const visit=(nodes)=>nodes.flatMap(n=>[{id:n.id,type:n.type,label:n.label,expanded:n.isExpanded,loaded:store.isTreeNodeChildrenLoaded(n.id)},...visit(n.children??[])]);
    return visit(root?[root]:[]);
  });
  await row(config.id).waitFor();
  await toggle(config.id);
  await row(`${config.id}:erp_base`).waitFor();
  const search=page.locator('input[placeholder]').first();
  await search.fill('北方');
  await page.waitForTimeout(800);
  assert.equal(calls.filter(c=>c.path==='/api/schema/tables').length,0,'Search must not load unopened databases');
  const untouched=await state();
  assert.ok(untouched.filter(n=>n.type==='database').every(n=>!n.loaded&&!n.expanded));
  await page.screenshot({path:`${output}/01-search-no-auto-open.png`,fullPage:true});

  await toggle(`${config.id}:erp_base`);
  let opened=await state();
  assert.ok(opened.find(n=>n.id===`${config.id}:erp_base`).expanded);
  assert.ok(opened.filter(n=>n.type==='database'&&n.id!==`${config.id}:erp_base`).every(n=>!n.loaded&&!n.expanded));
  const group=opened.find(n=>n.type==='group-tables');
  assert.ok(group,'The selected database should expose its Tables group');
  await page.screenshot({path:`${output}/02-only-selected-database-open.png`,fullPage:true});

  await toggle(group.id);
  assert.ok((await state()).find(n=>n.id===group.id).expanded);
  const queriesBeforeToggle=calls.filter(c=>c.path==='/api/schema/tables').length;
  await toggle(group.id);
  assert.equal((await state()).find(n=>n.id===group.id).expanded,false);
  await toggle(group.id);
  assert.equal((await state()).find(n=>n.id===group.id).expanded,true);
  assert.equal(calls.filter(c=>c.path==='/api/schema/tables').length,queriesBeforeToggle,'Cached re-expansion must not reload tables');
  await page.screenshot({path:`${output}/03-cached-group-reexpanded.png`,fullPage:true});

  await search.fill('zz_late_orders');
  await page.waitForTimeout(1000);
  const match=page.locator('[data-node-id]').filter({hasText:'zz_late_orders'});
  assert.ok(await match.count(),'A table beyond the first page must be searchable without clearing the query');
  assert.ok(calls.filter(c=>c.path==='/api/schema/tables').every(c=>c.query.database==='erp_base'),'Other databases must remain untouched');
  assert.deepEqual(errors,[],'The real frontend must not raise runtime exceptions');
  await page.screenshot({path:`${output}/04-late-table-search-without-clearing.png`,fullPage:true});
  const summary={scenario:'Issue #13459: real Vue frontend with an isolated MySQL HTTP metadata fixture',browser:'Google Chrome / Playwright',assertions:['Searching a connection name does not load unopened databases','Only the selected database opens','A cached Tables group collapses and re-expands without requests','A table beyond the first page is found after replacing the non-empty query','No frontend runtime errors'],tableRequests:calls.filter(c=>c.path==='/api/schema/tables').map(c=>c.query),finalState:await state(),errors};
  await fs.writeFile(`${output}/verification.json`,JSON.stringify(summary,null,2));
  console.log('BROWSER VERIFICATION PASSED',JSON.stringify(summary,null,2));
} finally {
  await browser.close();
}
