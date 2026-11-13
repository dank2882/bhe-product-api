"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {validateOutput}=require("../lib/life-context-observations");
const at="2026-11-13T16:00:00Z";
function fixture(){
 const row=(id,time,text,thread="fictional-thread")=>({id,source:"messages",identity:"provisional",sourceReference:`messages:${thread}#provisional-${id}`,sourceTime:`2026-11-12T${time}:00Z`,text});
 const entries=[row("request","18:00","Riley: Can you receive Morgan's crate?"),row("intervening","18:10","Riley: Did you get Avery's email about the other crate?"),row("reply","18:20","Dan (sent): Yeah all books we can do that"),row("independent","18:30","Riley: The office opens at nine.")];
 const claim=(ids,text,certainty="reported")=>({text,certainty,purposes:["planning"],sourceIds:ids,support:ids.map(id=>({sourceId:id,quote:entries.find(e=>e.id===id).text}))});
 const bad=claim(["request","reply"],"Dan agreed to receive Morgan's crate.","resolved_in_source"),good=claim(["independent"],"Riley reports the office opens at nine.");
 return {entries,claim,bad,good};
}
test("uncited intervening question rejects a guessed reply link but preserves valid output",()=>{
 const f=fixture(),r=validateOutput({observations:[f.bad,f.good]},f,at);
 assert.equal(r.validation.status,"partial");assert.equal(r.validation.rejectedCount,1);
 assert.equal(r.validation.rejections[0].reason,"ambiguous_reply");
 assert.deepEqual(r.observations.map(o=>o.id),["observation-2"]);
 assert.equal(r.observations[0].text,f.good.text);
 assert(!JSON.stringify(r.validation).includes("Morgan"));
});
test("adding the competing question as a citation or relabeling certainty cannot bypass the guard",()=>{
 for(const certainty of ["reported","tentative","confirmed_in_source","resolved_in_source"]){
  const f=fixture(),bad=f.claim(["request","intervening","reply"],"Dan can receive Morgan's crate.",certainty);
  assert.throws(()=>validateOutput({observations:[bad]},f,at),/Ambiguous reply/);
 }
});
test("explicit object, adjacent short agreement, or separate conversation are not rejected",()=>{
 for(const change of [
  f=>{f.entries[2].text="Dan (sent): Yes, we can receive Morgan's crate.";},
  f=>{f.entries.splice(1,1);},
  f=>{f.entries[1].sourceReference="messages:another-thread#intervening";}
 ]){
  const f=fixture();change(f);const o=f.claim(["request","reply"],"Dan agreed to receive Morgan's crate.","resolved_in_source");
  assert.equal(validateOutput({observations:[o]},f,at).validation.status,"passed");
 }
});
test("request-only attributed statement remains useful without guessing an answer",()=>{
 const f=fixture(),o=f.claim(["request"],"Riley asked about receiving Morgan's crate.");
 assert.equal(validateOutput({observations:[o]},f,at).validation.status,"passed");
});
test("input ordering and quoted substrings cannot hide intervening source evidence",()=>{
 const f=fixture();f.entries.reverse();f.bad.support[1].quote="we can do that";
 assert.throws(()=>validateOutput({observations:[f.bad]},f,at),/Ambiguous reply/);
});
