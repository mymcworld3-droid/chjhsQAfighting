'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bag = fs.readFileSync(path.join(__dirname, '../public/cultivation/unified-inventory-grid.js'), 'utf8');
const golden = fs.readFileSync(path.join(__dirname, '../public/cultivation/cultivation-training-v4.js'), 'utf8');
const foundation = fs.readFileSync(path.join(__dirname, '../public/cultivation/foundation-training-page.js'), 'utf8');

class Node {
  constructor(tag, attrs = {}, children = []) {
    this.nodeType = tag === '#text' ? 3 : 1;
    this.nodeName = this.nodeType === 3 ? tag : tag.toUpperCase();
    this.tagName = this.nodeType === 1 ? this.nodeName : undefined;
    this.nodeValue = this.nodeType === 3 ? attrs : null;
    this.values = new Map(this.nodeType === 1 ? Object.entries(attrs) : []);
    this.parentNode = null;
    this.childNodes = [];
    this.value = '';
    children.forEach(child => this.insertBefore(child, null));
  }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get attributes() {
    return [...this.values].map(([name,value]) => ({ name, value }));
  }
  getAttribute(name) { return this.values.has(name) ? this.values.get(name) : null; }
  hasAttribute(name) { return this.values.has(name); }
  setAttribute(name,value) { this.values.set(name, String(value)); }
  removeAttribute(name) { this.values.delete(name); }
  insertBefore(node, before) {
    if (node === before) return node;
    node.remove();
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (before && index < 0) throw Error('Missing sibling');
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
    node.parentNode = this;
    return node;
  }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.childNodes;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
}
const el = (tag, attrs = {}, ...children) => new Node(tag, attrs, children);
const marker = text => new Node('#text', text);
const source = bag.slice(bag.indexOf('  function stableDomKey('), bag.indexOf('  function listenOnce('));
if (!source.startsWith('  function stableDomKey(') || !source.includes('function reconcileChildren(')) {
  throw new Error('Stable image reconciliation helpers missing');
}
const ctx = vm.createContext({});
vm.runInContext(source + '\nthis.patch = reconcileNode;', ctx);

test('equipment rerenders preserve decoded images on unchanged keyed cards and moved items', () => {
  const firstImage = el('img', {src:'images/a.webp',class:'ui-content-image'});
  const secondImage = el('img', {src:'images/b.webp',class:'ui-content-image'});
  const current = el('section', {},
    el('div', {class:'uib-grid'},
      el('button', {'data-uib-item':'artifact:a'}, el('span', {}, firstImage), marker('A')),
      el('button', {'data-uib-item':'artifact:b'}, el('span', {}, secondImage), marker('B'))));
  const desired = el('section', {},
    el('div', {class:'uib-grid'},
      el('button', {'data-uib-item':'artifact:b'}, el('span', {}, el('img',{src:'images/b.webp',class:'ui-content-image'})), marker('B updated')),
      el('button', {'data-uib-item':'artifact:a',class:'is-equipped'}, el('span', {}, el('img',{src:'images/a.webp',class:'ui-content-image'})),marker('A'))));
  ctx.patch(current, desired);
  const [b,a] = current.firstChild.childNodes;
  assert.equal(b.getAttribute('data-uib-item'),'artifact:b');
  assert.equal(a.getAttribute('data-uib-item'),'artifact:a');
  assert.equal(b.firstChild.firstChild, secondImage);
  assert.equal(a.firstChild.firstChild, firstImage);
  assert.equal(a.getAttribute('class'),'is-equipped');
  assert.equal(b.childNodes[1].nodeValue,'B updated');
});

test('changing one equipped slot does not discard the image in another slot', () => {
  const retained = el('img', {src:'images/remains.webp'});
  const current = el('div', {},
    el('button', {'data-uib-slot':'護身法寶','data-uib-equipped-item':'artifact:a'},el('span',{},retained)),
    el('button', {'data-uib-slot':'佩飾法寶','data-uib-empty-slot':'佩飾法寶'},el('span',{},marker('empty'))));
  const desired = el('div', {},
    el('button', {'data-uib-slot':'護身法寶','data-uib-equipped-item':'artifact:a'},el('span',{},el('img',{src:'images/remains.webp'}))),
    el('button', {'data-uib-slot':'佩飾法寶','data-uib-equipped-item':'artifact:b'},el('span',{},el('img',{src:'images/new.webp'}))));
  ctx.patch(current, desired);
  assert.equal(current.firstChild.firstChild.firstChild,retained);
  assert.equal(current.childNodes[1].getAttribute('data-uib-equipped-item'),'artifact:b');
  assert.equal(current.childNodes[1].getAttribute('data-uib-empty-slot'),null);
});

test('inventory updates do not replace the full root when it already exists', () => {
  assert.match(bag,/if \(mounted && root\.dataset\.signature === signature\) return/);
  assert.match(bag,/reconcileNode\(root, template\.content\.firstElementChild\)/);
  assert.match(bag,/const boundControls = new WeakSet\(\)/);
  assert.match(bag,/listenOnce\(button, 'click'/);
  assert.match(golden,/if \(!equipmentReady && !content\.querySelector\('\.uib-equipment-shell'\)\)/);
  assert.match(foundation,/!content\.querySelector\('#unified-cultivation-bag\.uib-equipment-view'\)/);
});
