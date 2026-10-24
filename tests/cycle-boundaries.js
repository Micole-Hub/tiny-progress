'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
for(const file of ['github-page/domain.js','backend/domain.js','gas/TPDomain.gs']){
 let day='2026-10-24';const RealDate=Date;
 class Clock extends RealDate{constructor(...a){super(...(a.length?a:[day+'T04:00:00Z']));}static now(){return RealDate.parse(day+'T04:00:00Z');}}
 const context={module:{exports:{}},Date:Clock,Intl,Utilities:{formatDate:()=>day},console};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);const D=context.module.exports;
 const s=D.empty('2026-10-26');const t=D.add(s,'提前完成',1),deleted=D.add(s,'刪除事項',1),pending=D.add(s,'未完成',1);
 D.setCompletion(s,t.id,true);t.note='完成備註';D.remove(s,deleted.id,'刪除原因');
 s.reflections[1]={good:'週回顧',adjust:'調整',savedAt:'2026-10-24T04:00:00Z'};
 D.advance(s);assert.equal(D.currentWeek(s),1);assert.equal(s.archivedWeeks.length,0);assert.equal(D.leaves(s,1).length,1);
 day='2026-10-26';D.advance(s);assert.equal(D.currentWeek(s),1);assert.equal(s.archivedWeeks.length,0);
 day='2026-11-01';D.advance(s);assert.equal(D.currentWeek(s),1);assert.equal(s.archivedWeeks.length,0);
 day='2026-11-02';D.advance(s);assert.equal(D.currentWeek(s),2);assert.equal(s.archivedWeeks.length,1);
 const snap=s.archivedWeeks[0];assert.equal(snap.week,1);assert.equal(snap.completed.length,1);assert.equal(snap.completed[0].note,'完成備註');assert.equal(snap.completed[0].date,'2026-10-24');assert.equal(snap.deleted[0],'刪除事項｜刪除原因');assert.equal(snap.reflection.good,'週回顧');assert.equal(pending.week,1);assert.equal(pending.done,false);
 const before=JSON.stringify(snap);D.advance(s);assert.equal(s.archivedWeeks.length,1);assert.equal(JSON.stringify(s.archivedWeeks[0]),before);assert.throws(()=>D.setCompletion(s,pending.id,true),/封存/);
 // Completing every task opens planning, but never advances the actual week or history.
 day='2026-10-24';const all=D.empty('2026-10-26');const only=D.add(all,'全數提前完成',1);D.setCompletion(all,only.id,true);D.advance(all);assert.equal(D.currentWeek(all),1);assert.equal(all.archivedWeeks.length,0);D.add(all,'Week2預排',2);assert.equal(D.currentWeek(all),1);
 // Recurring items are generated once and old snapshots stay immutable.
 day='2026-11-02';s.recurringRules.push({id:'daily',title:'每日習慣',frequency:'daily',timesPerWeek:7,categoryId:'learn',active:true});D.advance(s);const habits=s.tasks.filter(x=>x.recurringRuleId==='daily'&&x.week===2);assert.equal(habits.length,1);assert.equal(habits[0].occurrences.length,7);D.advance(s);assert.equal(s.tasks.filter(x=>x.recurringRuleId==='daily'&&x.week===2).length,1);assert.equal(JSON.stringify(s.archivedWeeks[0]),before);
 day='2027-01-17';D.advance(s);assert.equal(D.currentWeek(s),12);assert.equal(s.archivedWeeks.length,11);
 day='2027-01-18';D.advance(s);assert.equal(D.currentWeek(s),12);assert.equal(s.archivedWeeks.length,12);D.advance(s);assert.equal(s.archivedWeeks.length,12);
 console.log('PASS '+file+': rest, early completion, week boundaries, preserved notes/reasons, immutable snapshots, recurring idempotence, cycle end');
}
