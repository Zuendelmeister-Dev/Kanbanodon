const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function helpers() {
  const fields = [{id:'dTitle',type:'text',value:'Original',dataset:{}},{id:'commentBody',type:'textarea',value:'',dataset:{}}];
  let answer = false, confirmations = 0;
  const context = { editing:{id:1,links:[]}, drawerDraftId:1, drawerSnapshot:'', $:()=>({querySelectorAll:()=>fields}), confirm:()=>{ confirmations++;return answer; }, escAttr:s=>String(s).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])) };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'task-tools.js'),'utf8'),context);
  return {context,fields,answer(value){answer=value;},confirmations(){return confirmations;}};
}

test('checklist progress uses saved booleans and safely escapes editable text',()=>{
  const {context}=helpers();
  assert.equal(context.checklistProgress({extras:{Checklist:[{Text:'Prepare',Done:true},{Text:'Review',Done:false}]}}),'1/2');
  assert.equal(context.checklistProgress({extras:{}}),'');
  const html=context.checklistRowHTML({Text:'"><img src=x onerror=alert(1)>',Done:false},0);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&quot;&gt;&lt;img'));
});

test('closing unchanged drafts is silent; changed task fields and comments need confirmation',()=>{
  const fixture=helpers(), {context,fields}=fixture;
  context.drawerSnapshot=context.currentDrawerSnapshot();
  assert.equal(context.canLeaveDrawer(),true);
  assert.equal(fixture.confirmations(),0);
  fields[0].value='Edited';
  assert.equal(context.canLeaveDrawer(),false);
  assert.equal(fields[0].value,'Edited');
  fixture.answer(true);
  assert.equal(context.canLeaveDrawer(),true);
  assert.equal(context.drawerSnapshot,'');
  context.drawerSnapshot=context.currentDrawerSnapshot();
  fields[1].value='Comment draft';fixture.answer(false);
  assert.equal(context.canLeaveDrawer(),false);
});

test('visible task filters escape search and assignee text and distinguish another assignee from My tasks', () => {
  const {context} = helpers();
  const values = {search: '"><img src=x onerror=alert(1)>', typeFilter: '', labelFilter: '', assigneeFilter: '7', dependencyFilter: 'blocked'};
  context.$ = selector => ({value: values[selector.slice(1)] || ''});
  context.state = {me: {id: 3}};
  context.userById = () => ({id: 7, name: '<script>Owner</script>'});
  context.esc = context.escAttr;
  let html = context.activeTaskFiltersHtml();
  assert.doesNotMatch(html, /<img|<script>/);
  assert.match(html, /Assignee: &lt;script&gt;Owner&lt;\/script&gt;/);
  assert.match(html, /Blocked tasks/);
  assert.doesNotMatch(html, /My tasks:/);
  context.state.me.id = 7; html = context.activeTaskFiltersHtml();
  assert.match(html, /My tasks: &lt;script&gt;Owner/);
  assert.equal((html.match(/data-clear-task-filter=/g) || []).length, 3);
});
