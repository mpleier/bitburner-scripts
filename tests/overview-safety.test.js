import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewHackingPhase,overviewTooltipPlacement,overviewResetMatches} from '../overview-safety-policy.js';
test('installed augmentation requirement is not misclassified as installing The Red Pill',()=>{
 assert.equal(overviewHackingPhase({name:'Installed augmentation requirement'},'prepare',false),'need augmentations');assert.equal(overviewHackingPhase({name:'Install The Red Pill'},null,false),'install TRP');assert.equal(overviewHackingPhase({name:'Join Daedalus'},null,false),'Daedalus');
});
test('tooltip placement stays in the viewport and flips above near the bottom',()=>{
 for(const anchor of [{left:0,right:40,top:200,bottom:220},{left:100,right:140,top:650,bottom:670},{left:800,right:850,top:30,bottom:50}]){
  const p=overviewTooltipPlacement(anchor,{width:680,height:300},{width:900,height:700});assert.ok(p.left>=8&&p.left+680<=892);assert.ok(p.top>=8&&p.top+300<=692);
 }
 const p=overviewTooltipPlacement({right:140,top:650,bottom:670},{width:680,height:300},{width:900,height:700});assert.ok(p.top<650);
});
test('oversized tooltips use a bounded scrolling area',()=>{const p=overviewTooltipPlacement({right:40,top:50,bottom:70},{width:1000,height:1200},{width:320,height:480});assert.equal(p.maxWidth,304);assert.equal(p.maxHeight,464);assert.equal(p.left,8);assert.equal(p.top,8);});
test('legacy status records must still be newer than the current reset',()=>{assert.equal(overviewResetMatches({at:50},{lastNodeReset:100,lastAugReset:100}),false);assert.equal(overviewResetMatches({at:101},{lastNodeReset:100,lastAugReset:100}),true);});
