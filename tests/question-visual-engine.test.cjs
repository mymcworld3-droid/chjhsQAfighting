'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const E=require('../public/cultivation/question-visual-engine.js');
const plot={type:'plot',x:[-2,2],y:[-2,4],layers:[{type:'function',expr:['^','x',2]}]};
test('safe expression and domain',()=>{assert.equal(E.compile(['+', ['^','x',2],1])(3),10);assert.match(E.render(plot),/<path d=/);assert.equal(E.inspect({...plot,x:[1,1]}).valid,false)});
test('reject arbitrary code and excessive samples',()=>{for(const expr of [['constructor','x'],'window',['sin','x',2]])assert.equal(E.inspect({...plot,layers:[{type:'function',expr}]}).valid,false);assert.equal(E.inspect({...plot,layers:[{type:'function',expr:'x',samples:10000}]}).valid,false)});
test('escape labels and validate rectangular tables',()=>{const html=E.render({type:'table',headers:['<script>'],rows:[[1]]});assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.equal(E.inspect({type:'table',headers:['A'],rows:[[1,2]]}).valid,false)});
test('general geometry, scatter, bars and parametric functions',()=>{assert.equal(E.inspect({...plot,layers:[{type:'parametric',domain:[0,6.28],xExpr:['cos','t'],yExpr:['sin','t']},{type:'arrow',from:[0,0],to:[1,2]},{type:'polygon',points:[[0,0],[1,1],[1,0]]},{type:'ellipse',center:[0,0],radii:[1,1]},{type:'scatter',points:[[1,1]]},{type:'bars',points:[[0,1]]}]}).valid,true)});
