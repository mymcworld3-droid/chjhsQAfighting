/* V1 private weapon definitions. Development catalog delegates to the canonical manual definitions.
 * Public authorization is exclusively QAManuals.BOOKS/BY_SKILL, controlled
 * by RELEASE_NEW_WEAPONS; never authorize a cast from this module. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./manual-rules.js'));
  else root.QANewWeaponDrafts=factory(root.QAManuals);
})(globalThis,Manuals=>{
  'use strict';
  const freeze=o=>{if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
  const BOOKS=Manuals.DEVELOPMENT_BOOKS;
  const BY_BOOK=freeze(Object.fromEntries(BOOKS.map(b=>[b.id,b])));
  const BY_SKILL=freeze(Object.fromEntries(BOOKS.flatMap(b=>b.skills.map(s=>[s.id,s]))));
  const skillAtLevel=(id,level,stars)=>Object.hasOwn(BY_SKILL,id)?Manuals.skillAtLevel(BY_SKILL[id],level,stars):null;
  const mastered=(id,exp)=>Object.hasOwn(BY_SKILL,id)&&Manuals.levelForExp(exp)>=BY_SKILL[id].levelRequired;
  return Object.freeze({BOOKS,BY_BOOK,BY_SKILL,skillAtLevel,mastered});
});
