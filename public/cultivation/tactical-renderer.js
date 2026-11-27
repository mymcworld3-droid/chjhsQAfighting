import './battle-presentation.js';
import './weapon-effects.js';
import './weapon-geometry.js';
import './prism-weapon-rules.js';
import './bell-weapon-rules.js';
import './manual-rules.js?v=20261116-loadout-presets-v1';
import './new-weapon-drafts.js';
import './weapon-special-objects.js';
import './weave-weapon-rules.js';
import './mirror-weapon-rules.js';
import './time-weapon-rules.js';
import './gravity-weapon-rules.js';
import './flying-sword-path.js?v=20261120-sword-movement-v1';
import './tactical-rules.js?v=20261120-guided-first-stage-v1';
import './tactical-animation.js?v=20261126-flying-sword-v1';
import './tactical-skill-effects.js?v=20261126-flying-sword-v1';
import './tactical-camera.js';
import './tactical-ambience.js?v=20261118-pve-visual-v2';
import './tactical-impact-presentation.js?v=20261118-combat-phase3-v1';
import './tactical-threat-visuals.js?v=20261118-phase5-v1';
import './tactical-target-visuals.js?v=20261118-phase6-v1';
import './tactical-compass.js?v=20261118-phase7-v1';
import './tactical-seal-ranges.js?v=20261119-seal-ranges-v1';
import './tactical-seal-targeting.js?v=20261119-seal-target-v1';
import './tactical-objective-visuals.js?v=20261119-objective-vfx-v1';
const R=globalThis.QATactical;
const attackSkill=(actor,mode)=>mode.startsWith('manual:')?(R.manualSkillFor(actor,mode.slice(7))||R.basicFor(actor)):R.basicFor(actor);
const A=globalThis.QATacticalAnimation;
const SkillEffects=globalThis.QATacticalSkillEffects;
const Camera=globalThis.QATacticalCamera;
const Ambience=globalThis.QATacticalAmbience;
const Impact=globalThis.QATacticalImpact;
const Threats=globalThis.QATacticalThreats;
const Targets=globalThis.QATacticalTargetVisuals;
const Compass=globalThis.QATacticalCompass;
const SealRanges=globalThis.QATacticalSealRanges;
const SealTargets=globalThis.QATacticalSealTargeting;
const ObjectiveVFX=globalThis.QATacticalObjectiveVisuals;
const SEAL_ATLAS='/assets/seals/seal-atlas.webp';
const SEAL_FRAME_SIZE=128; // 4 columns: shield, hazard, rage, maze; 3 rows: intact, damaged, broken.
const GUARDIAN_ATLAS='/assets/shrines/guardian-atlas.webp';
const GUARDIAN_FRAME_SIZE=160; // three columns: intact, damaged, collapsed
const SOURCES={ground:'/assets/world-map/ai/ground-atlas.webp',props:'/assets/world-map/ai/props-atlas.webp',
  monsters:'/assets/world-map/ai/creatures-atlas.webp',male:'/assets/world-map/players/player-male.webp',female:'/assets/world-map/players/player-female.webp'};

export class TacticalRenderer{
  constructor(canvas,onSelect,onActivity=()=>{},onInspect=()=>{},onSealPeek=()=>{}){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.onSelect=onSelect;this.onActivity=onActivity;this.onInspect=onInspect;this.onSealPeek=onSealPeek;this.images={};this.frame=0;this.gestureFrame=0;this.ambientTimer=null;this.ambience=null;this.ambienceLayer=null;this.stageKey=null;this.destroyed=false;this.paused=false;this.range=[];this.threatPlan=null;this.targetPlan=null;this.hoverSelection=null;this.hoverPlan=null;this.compassMarkers=[];this.focusBeastIndex=0;this.queue=[];this.scene=null;this.focusAuras=new Map();this.heldAt=null;this.camera=Camera.create();this.touches=new Map();this.dragging=false;this.suppressClickUntil=0;this.pinch=null;this.hoverUid=null;this.inspectedUid=null;this.longPressTimer=null;this.longPressTriggered=false;this.sealRangePlan={seals:[]};this.sealRangeMode='all';this.sealRangeFocusId=null;this.sealTargetPlan={seals:[]};this.objectiveCues=[];
    this.reducedMotion=window.matchMedia('(prefers-reduced-motion:reduce)');
    this.refresh=()=>this.draw();document.addEventListener('visibilitychange',this.refresh);this.reducedMotion.addEventListener('change',this.refresh);
    // Only terrain and monsters are universal to every arena. Character
    // atlases are requested when their gender actually appears in a room.
    for(const id of ['ground','props','monsters']){
      const img=new Image();img.decoding='async';
      img.onload=()=>{if(!this.destroyed)this.requestDraw();};
      img.onerror=()=>{if(!this.destroyed)this.requestDraw();};
      img.src=SOURCES[id];this.images[id]=img;
    }
    this.resize=new ResizeObserver(()=>this.requestDraw());this.resize.observe(canvas);

    // Pointer Events support one-finger/map drag, two-finger pinch and
    // mouse drag. A dragged gesture is NEVER interpreted as a grid command.
    const point=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
    const view=()=>this.preview?.view||{x:0,y:0,width:this.state?.width||1,height:this.state?.height||1};
    const size=()=>{const r=canvas.getBoundingClientRect();return{w:r.width,h:r.height};};
    const midpoint=()=>{
      const a=[...this.touches.values()];if(a.length<2)return null;
      return {x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2,
        gap:Math.max(1,Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y))};
    };
    this.onPointerDown=e=>{
      if(!this.state||this.preview||this.paused||e.pointerType==='mouse'&&e.button!==0)return;
      const p=point(e);
      this.touches.set(e.pointerId,{...p,startX:p.x,startY:p.y});
      this.clearLongPress();this.longPressTriggered=false;
      this.setHoverPreview(null);
      if(this.touches.size>=2){this.dragging=true;this.pinch=midpoint();}
      else if(e.pointerType!=='mouse'&&this.state.mode==='pve'){
        const beast=this.beastAtClient(e.clientX,e.clientY);
        const tile=this.tileAtClient(e.clientX,e.clientY);
        if(beast||tile){
          const actorUid=beast?.uid;
          this.longPressTimer=setTimeout(()=>{
            this.longPressTimer=null;
            if(this.destroyed||this.dragging||this.touches.size!==1||this.isAnimating)return;
            if(actorUid&&!this.state?.actors.some(a=>a.uid===actorUid&&a.hp>0))return;
            this.longPressTriggered=true;this.suppressClickUntil=Date.now()+800;
            if(actorUid)this.onInspect(actorUid,'pin');
            else{
              const seal=R.sealInfo(this.state,tile);
              if(seal)this.onSealPeek(seal,'pin');
              else this.setHoverPreview(tile);
            }
          },500);
        }
      }
      try{canvas.setPointerCapture(e.pointerId);}catch(_){}
    };
    this.onPointerMove=e=>{
      if(e.pointerType==='mouse'&&!this.touches.has(e.pointerId)){
        const p=point(e),marker=Compass.pick(this.compassMarkers,p.x,p.y);
        canvas.style.cursor=marker?'pointer':'';
        if(marker)canvas.title='點選定位：'+marker.name;
        else{
          const tile=this.tileAtClient(e.clientX,e.clientY);
          const seal=tile?R.sealInfo(this.state,tile):null;
          if(seal)canvas.title=SealTargets.summary(seal,'move')+'（可破壞的封印機關）';
          else canvas.removeAttribute('title');
        }
        const beast=this.beastAtClient(e.clientX,e.clientY),next=beast?.uid||null;
        if(next!==this.hoverUid){
          this.hoverUid=next;this.onInspect(next,'hover');
        }
        this.setHoverPreview(this.tileAtClient(e.clientX,e.clientY));
        return;
      }
      if(this.longPressTriggered)return;
      const before=this.touches.get(e.pointerId);if(!before)return;
      const after=point(e),deltaX=after.x-before.x,deltaY=after.y-before.y;
      if(Math.hypot(after.x-before.startX,after.y-before.startY)>8){this.clearLongPress();this.setHoverPreview(null);}
      before.x=after.x;before.y=after.y;
      const {w,h}=size(),v=view();
      if(this.touches.size>=2){
        const next=midpoint();
        if(this.pinch&&next){
          this.camera=Camera.pan(this.camera,next.x-this.pinch.x,next.y-this.pinch.y,w,h,v);
          this.camera=Camera.zoomAt(this.camera,this.camera.zoom*next.gap/this.pinch.gap,next.x,next.y,w,h,v);
          this.pinch=next;this.dragging=true;
          this.requestDraw();e.preventDefault();
        }
      }else{
        if(Math.hypot(after.x-before.startX,after.y-before.startY)>7)this.dragging=true;
        if(this.dragging){
          this.camera=Camera.pan(this.camera,deltaX,deltaY,w,h,v);
          this.requestDraw();e.preventDefault();
        }
      }
    };
    this.onPointerEnd=e=>{
      const prior=this.touches.get(e.pointerId);
      if(!prior)return;
      // A final movement or system cancellation still counts as a drag.
      // Browsers differ in whether they deliver the last pointermove.
      const finalPoint=point(e);
      if(Math.hypot(finalPoint.x-prior.startX,finalPoint.y-prior.startY)>8)this.dragging=true;
      if(e.type==='pointercancel'||e.type==='lostpointercapture')this.dragging=true;
      this.clearLongPress();
      if(this.longPressTriggered){this.suppressClickUntil=Date.now()+800;this.longPressTriggered=false;}
      if(this.dragging){this.suppressClickUntil=Date.now()+500;this.setHoverPreview(null);}
      this.touches.delete(e.pointerId);
      try{if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}catch(_){}
      if(this.touches.size===1){
        const only=[...this.touches.values()][0];only.startX=only.x;only.startY=only.y;this.dragging=true;
      }else if(!this.touches.size)this.dragging=false;
      this.pinch=null;
    };
    this.onWheel=e=>{
      if(!this.state||this.preview||this.paused)return;
      e.preventDefault();
      const p=point(e),{w,h}=size();
      this.camera=Camera.zoomAt(this.camera,this.camera.zoom*Math.exp(-e.deltaY*.0013),p.x,p.y,w,h,view());
      this.requestDraw();
    };
    this.onPointerLeave=()=>{
      canvas.style.cursor='';canvas.removeAttribute('title');
      if(this.hoverUid){this.hoverUid=null;this.onInspect(null,'hover');}
      if(!this.touches.size)this.setHoverPreview(null);
    };
    // Suppress native touch selection/callouts without blocking our 500ms
    // press-and-hold creature inspection.
    this.onContextMenu=event=>event.preventDefault();
    canvas.addEventListener('contextmenu',this.onContextMenu);
    canvas.addEventListener('pointerleave',this.onPointerLeave);
    canvas.addEventListener('pointerdown',this.onPointerDown);
    canvas.addEventListener('pointermove',this.onPointerMove);
    canvas.addEventListener('pointerup',this.onPointerEnd);
    canvas.addEventListener('pointercancel',this.onPointerEnd);
    canvas.addEventListener('lostpointercapture',this.onPointerEnd);
    canvas.addEventListener('wheel',this.onWheel,{passive:false});
    this.onCanvasClick=event=>{
      if(!this.state||this.preview||this.isAnimating||this.paused||Date.now()<this.suppressClickUntil)return;
      const rect=canvas.getBoundingClientRect();
      const x=event.clientX-rect.left,y=event.clientY-rect.top;
      if(this.state.mode==='pve'){
        const view={x:0,y:0,width:this.state.width,height:this.state.height};
        const g=Camera.geometry(this.camera,rect.width,rect.height,view);
        const marks=Compass.derive(this.state,this.uid,{ox:g.ox,oy:g.oy,
          cell:g.cell,width:rect.width,height:rect.height});
        const marker=Compass.pick(marks,x,y);
        if(marker){
          this.focusCameraOn(marker.target);
          this.suppressClickUntil=Date.now()+160;
          return;
        }
      }
      const p=Camera.tileAt(this.camera,x,y,rect.width,rect.height,
        {x:0,y:0,width:this.state.width,height:this.state.height});
      if(R.inside(this.state,p))this.onSelect(p);
    };
    this.onCanvasKeyDown=event=>{
      if(!this.state||this.preview||this.isAnimating||this.paused)return;
      if(this.state.mode==='pve'){
        const key=event.key.toLowerCase();
        if(['home','0','b','n'].includes(key)){
          event.preventDefault();
          if(key==='0')this.resetView();
          else if(key==='home')this.focusCameraOn(this.state.actors.find(a=>a.uid===this.uid));
          else if(key==='b')this.focusCameraOn(this.state.actors.find(a=>a.boss&&a.hp>0));
          else {
            const beasts=this.state.actors.filter(a=>a.bot&&a.hp>0);
            if(beasts.length)this.focusCameraOn(beasts[this.focusBeastIndex++%beasts.length]);
          }
          return;
        }
      }
      const delta={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[event.key];
      if(!delta)return;event.preventDefault();
      const p=this.selection||this.state.actors.find(a=>a.uid===this.uid)||{x:0,y:0};
      const next={x:p.x+delta[0],y:p.y+delta[1]};
      if(R.inside(this.state,next))this.onSelect(next);
    };
    canvas.addEventListener('click',this.onCanvasClick);
    canvas.addEventListener('keydown',this.onCanvasKeyDown);
  }
  requestDraw(){
    // Pointermove and ResizeObserver may fire far faster than the display.
    // Coalesce those updates without delaying input or tactical state changes.
    if(this.destroyed||this.gestureFrame)return;
    if(this.frame){cancelAnimationFrame(this.frame);this.frame=0;}
    this.gestureFrame=requestAnimationFrame(()=>{
      this.gestureFrame=0;this.draw();
    });
  }
  clearLongPress(){
    if(this.longPressTimer!==null)clearTimeout(this.longPressTimer);
    this.longPressTimer=null;
  }
  tileAtClient(clientX,clientY){
    if(!this.state||this.preview||this.paused||this.isAnimating)return null;
    const rect=this.canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return null;
    const p=Camera.tileAt(this.camera,clientX-rect.left,clientY-rect.top,rect.width,rect.height,
      {x:0,y:0,width:this.state.width,height:this.state.height});
    return R.inside(this.state,p)?p:null;
  }
  setHoverPreview(tile){
    if(this.preview||this.destroyed||this.state?.mode!=='pve')return;
    const me=this.state.actors?.find(a=>a.uid===this.uid);
    const active=me&&this.state.status==='active'&&this.state.turnUid===this.uid&&
      (!this.state.quizRound||this.state.phase==='action')&&!this.isAnimating;
    const next=active&&tile?{x:tile.x,y:tile.y}:null;
    if((!next&&!this.hoverSelection)||(next&&this.hoverSelection&&R.key(next)===R.key(this.hoverSelection)))return;
    this.hoverSelection=next;
    this.hoverPlan=next?Targets.derive(this.state,this.uid,this.mode,this.selection?.first?{...next,first:this.selection.first}:next,R,this.threatPlan,this.displaySkillPreview||this.skillPreview):null;
    if(this.hoverPlan){
      this.canvas.dataset.hoverPreviewCost=String(this.hoverPlan.cost);
      this.canvas.dataset.hoverPreviewValid=String(this.hoverPlan.valid);
      this.canvas.dataset.hoverPreviewTargets=String(this.hoverPlan.affected.length);
    }else{
      delete this.canvas.dataset.hoverPreviewCost;
      delete this.canvas.dataset.hoverPreviewValid;
      delete this.canvas.dataset.hoverPreviewTargets;
    }
    this.requestDraw();
  }
  beastAtClient(clientX,clientY){
    if(!this.state||this.preview||this.state.mode!=='pve'||this.isAnimating||this.paused)return null;
    const rect=this.canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return null;
    const p=Camera.tileAt(this.camera,clientX-rect.left,clientY-rect.top,rect.width,rect.height,
      {x:0,y:0,width:this.state.width,height:this.state.height});
    const actor=R.inside(this.state,p)?R.at(this.state,p):null;
    return actor?.bot&&R.alive(actor)?actor:null;
  }
  setInspectTarget(uid){
    const next=uid||null;
    if(this.inspectedUid===next)return;
    this.inspectedUid=next;this.draw();
  }
  setSealRangeMode(mode='all',focusId=null){
    const accepted=SealRanges.MODES.includes(mode)?mode:'all';
    const target=focusId||null;
    if(this.sealRangeMode===accepted&&this.sealRangeFocusId===target)return;
    this.sealRangeMode=accepted;this.sealRangeFocusId=target;this.requestDraw();
  }
  ensureCharacterSprites(state){
    const genders=new Set((state?.actors||[]).filter(a=>!a.bot)
      .map(a=>a.gender==='female'?'female':'male'));
    for(const id of genders){
      if(this.images[id]||this.destroyed)continue;
      const img=new Image();img.decoding='async';
      img.onload=()=>{if(!this.destroyed)this.requestDraw();};
      img.onerror=()=>{if(!this.destroyed)this.requestDraw();};
      img.src=SOURCES[id];this.images[id]=img;
    }
  }
  update(state,uid,mode,selection){
    this.ensureCharacterSprites(state);
    this.preview=null;
    // A single room can contain several stages of identical size. The map
    // layout and stage identities must be checked independently of room ID.
    const stageKey=Ambience.stageIdentity(state),newStage=this.stageKey!==stageKey;
    const mapKey=state.mode==='pve'?Ambience.mapIdentity(state):'';
    if(state.mode==='pve'&&this.ambience?.key!==mapKey){
      this.ambience=Ambience.prepare(state);
      this.ambienceLayer=Ambience.rasterize(this.ambience,()=>document.createElement('canvas'));
    }else if(state.mode!=='pve'){this.ambience=null;this.ambienceLayer=null;}
    this.canvas.dataset.ambientTheme=this.ambience?.theme||'none';
    if(newStage||this.state?.width!==state.width||this.state?.height!==state.height){
      this.compassMarkers=[];this.focusBeastIndex=0;this.objectiveCues=[];
      delete this.canvas.dataset.hoverPreviewCost;
      delete this.canvas.dataset.hoverPreviewValid;
      delete this.canvas.dataset.hoverPreviewTargets;
      this.queue=[];this.scene=null;this.hoverSelection=null;this.hoverPlan=null;this.camera=Camera.create();this.touches.clear();this.dragging=false;this.pinch=null;this.inspectedUid=null;this.hoverUid=null;this.clearLongPress();
      this.suppressClickUntil=Date.now()+120;
      if(state.mode==='pve'&&state.width>=11){
        const rect=this.canvas.getBoundingClientRect(),view={x:0,y:0,width:state.width,height:state.height},hero=state.actors.find(a=>a.uid===uid);
        if(rect.width&&rect.height&&hero){
          const initial=Camera.geometry(this.camera,rect.width,rect.height,view),zoom=Math.min(2.2,Math.max(1,42/initial.cell));
          const g=Camera.geometry({zoom},rect.width,rect.height,view);
          this.camera=Camera.normalize({zoom,panX:rect.width/2-(g.ox+(hero.x+.5)*g.cell),panY:rect.height/2-(g.oy+(hero.y+.5)*g.cell)},rect.width,rect.height,view);
        }
      }
    }
    this.stageKey=stageKey;
    if(!newStage&&!this.reducedMotion.matches){
      const planned=A.plan(this.state,state,uid);
      this.queue.push(...planned);
      if(planned.some(scene=>globalThis.QAWeaponEffects.prismSoundCues(scene.weaponTimeline,scene.skill).length))
        void window.QAGameAudio?.preload?.(globalThis.QAWeaponEffects.PRISM_SOUNDS);
      if(planned.some(scene=>globalThis.QAWeaponEffects.bellSoundCues(scene.weaponTimeline,scene.skill).length))
        void window.QAGameAudio?.preload?.(globalThis.QAWeaponEffects.BELL_SOUNDS);
      if(planned.some(scene=>globalThis.QAWeaponEffects.weaveSoundCues(scene.weaponTimeline,scene.skill).length))
        void window.QAGameAudio?.preload?.(globalThis.QAWeaponEffects.WEAVE_SOUNDS);
      if(planned.some(scene=>globalThis.QAWeaponEffects.timeSoundCues(scene.weaponTimeline,scene.skill).length))
        void window.QAGameAudio?.preload?.(globalThis.QAWeaponEffects.TIME_SOUNDS);
      const changes=ObjectiveVFX.transitions(this.state,state);
      if(changes.length)this.objectiveCues.push(...changes.map(cue=>({...cue,started:null})));
      if(this.objectiveCues.length>12)this.objectiveCues=this.objectiveCues.slice(-12);
    }
    if(this.state!==state||this.uid!==uid||this.mode!==mode){
      const me=state.actors.find(a=>a.uid===uid),mine=state.status==='active'&&state.turnUid===uid&&(!state.quizRound||state.phase==='action');
      this.range=mine?(mode==='move'?R.moveCells(state,me):mode==='sword-move'?R.swordMoveCells(state,me):R.aimCells(state,me,attackSkill(me,mode))):[];
    }
    // The target set stays separate from the affected-cell union. Cache only
    // across equivalent combat snapshots, not just equivalent selection clicks.
    const attackMode=mode==='attack'||mode.startsWith('manual:');
    const fighter=state.actors.find(a=>a.uid===uid);
    const signature=attackMode?JSON.stringify([state.id,state.revision,state.mode,
      state.status,state.turnUid,state.phase,state.quizRound,state.width,state.height,
      state.blocks,state.actors,state.trial,state.objective,state.weaponDungeon,state.weaponObjects,uid,mode]):'';
    if(signature!==this.skillPreviewSignature){
      this.skillPreviewSignature=signature;
      this.skillPreview=attackMode?R.skillPreviewPlan(state,fighter,attackSkill(fighter,mode)):null;
    }
    this.threatPlan=Threats.derive(state,uid,mode,this.range);
    // Compute once per authoritative state update, never in the animation loop.
    this.sealRangePlan=SealRanges.derive(state,R);
    this.sealTargetPlan=SealTargets.derive(state,uid,mode,R);
    this.displaySkillPreview=globalThis.QAWeaveRules.selectionPlan(this.skillPreview,selection);
    this.targetPlan=selection?.choosing?null:Targets.derive(state,uid,mode,selection,R,this.threatPlan,this.displaySkillPreview);
    this.hoverPlan=this.hoverSelection?
      Targets.derive(state,uid,mode,selection?.first?{...this.hoverSelection,first:selection.first}:this.hoverSelection,R,this.threatPlan,this.displaySkillPreview):null;
    const alert=this.canvas.parentElement?.querySelector('[data-threat-a11y]');
    if(state.mode==='pve'){
      const message=this.threatPlan.description+
        '。紅色斜紋框為目前預告範圍，青綠標記只能避開目前已標示的危險格。';
      this.canvas.setAttribute('aria-description',message+
        (this.targetPlan?'。選取目標：'+this.targetPlan.label+'。'+this.targetPlan.hint:'')+
        '。視野外方向標記可點選定位。Home定位自己，B定位首領，N切換靈獸，0重設鏡頭。');
      this.canvas.setAttribute('aria-keyshortcuts','Home B N 0');
      if(this.targetPlan){
        this.canvas.dataset.previewValid=String(this.targetPlan.valid);
        this.canvas.dataset.previewCost=String(this.targetPlan.cost);
        this.canvas.dataset.previewTargets=String(this.targetPlan.affected.length);
      }else{
        delete this.canvas.dataset.previewValid;
        delete this.canvas.dataset.previewCost;
        delete this.canvas.dataset.previewTargets;
      }
      this.canvas.dataset.threatCells=String(this.threatPlan.cells.length);
      this.canvas.dataset.threatened=String(this.threatPlan.playerThreatened);
      if(alert&&alert.textContent!==this.threatPlan.description)
        alert.textContent=this.threatPlan.description;
    }else{
      this.canvas.removeAttribute('aria-description');
      this.canvas.removeAttribute('aria-keyshortcuts');
      delete this.canvas.dataset.threatCells;
      delete this.canvas.dataset.threatened;
      delete this.canvas.dataset.previewValid;
      delete this.canvas.dataset.previewCost;
      delete this.canvas.dataset.previewTargets;
      if(alert)alert.textContent='';
    }
    this.state=state;this.uid=uid;this.mode=mode;this.selection=selection;this.activity();this.draw();
  }
  present(state,uid,scene=null,progress=0,view=null){
    this.ensureCharacterSprites(state);
    this.ambience=null;this.ambienceLayer=null;this.stageKey=null;this.canvas.dataset.ambientTheme='none';this.queue=[];this.scene=null;this.preview={scene,progress,view};this.state=state;this.uid=uid;this.mode='demo';this.selection=null;this.range=[];this.threatPlan=null;this.targetPlan=null;this.hoverSelection=null;this.hoverPlan=null;this.compassMarkers=[];this.sealRangePlan={seals:[]};this.sealTargetPlan={seals:[]};this.objectiveCues=[];this.canvas.removeAttribute('aria-description');this.canvas.removeAttribute('aria-keyshortcuts');this.draw();
  }
  get isAnimating(){return !!this.scene||this.queue.length>0;}
  get currentAction(){return (this.scene||this.queue[0])?.label||'';}
  get currentKind(){return (this.scene||this.queue[0])?.kind||'';}
  activity(){
    const kind=this.currentKind;this.canvas.dataset.animation=kind;this.canvas.setAttribute('aria-busy',String(this.isAnimating));
    queueMicrotask(()=>{if(!this.destroyed)this.onActivity();});
  }
  advance(now){
    let changed=false;
    while(this.scene&&now-this.scene.started>=this.scene.duration){
      const ended=this.scene,next=this.queue[0];
      // Carry leftover frame time into the next strike instead of inserting a
      // fresh frame of waiting between otherwise continuous chain movements.
      const linked=ended.style==='fist-chain'&&next?.kind==='cast'&&next.style==='fist-chain'&&
        ended.actor===next.actor&&ended.eventRevision===next.eventRevision;
      this.scene=linked?{...this.queue.shift(),started:ended.started+ended.duration}:null;
      changed=true;
    }
    if(!this.scene&&this.queue.length){this.scene={...this.queue.shift(),started:now};changed=true;}
    if(changed)this.activity();
    return this.scene?Math.min(1,(now-this.scene.started)/this.scene.duration):0;
  }
  setPaused(value){if(this.paused===value)return;this.paused=value;this.draw();}
  focusCameraOn(target){
    if(!target||!this.state||this.preview||this.paused)return false;
    const r=this.canvas.getBoundingClientRect();
    if(!r.width||!r.height)return false;
    const view={x:0,y:0,width:this.state.width,height:this.state.height};
    const base=Camera.geometry({zoom:this.camera.zoom,panX:0,panY:0},r.width,r.height,view);
    const x=Number(target.x),y=Number(target.y);
    if(!Number.isFinite(x)||!Number.isFinite(y))return false;
    const cx=x+(target.footprint?.width||0)*.5;
    const cy=y+(target.footprint?.height||0)*.5;
    this.camera=Camera.normalize({
      zoom:this.camera.zoom,
      panX:r.width/2-(base.ox+cx*base.cell),
      panY:r.height/2-(base.oy+cy*base.cell)
    },r.width,r.height,view);
    this.setHoverPreview(null);
    this.draw();return true;
  }
  resetView(){this.camera=Camera.create();this.focusBeastIndex=0;this.setHoverPreview(null);this.draw();}
  destroy(){this.destroyed=true;for(const aura of this.focusAuras.values())aura.remove();this.focusAuras.clear();this.canvas.removeEventListener('click',this.onCanvasClick);this.canvas.removeEventListener('keydown',this.onCanvasKeyDown);this.queue=[];this.scene=null;this.ambienceLayer=null;this.ambience=null;this.stageKey=null;clearTimeout(this.ambientTimer);this.ambientTimer=null;this.clearLongPress();this.canvas.removeEventListener('pointerleave',this.onPointerLeave);this.canvas.removeEventListener('contextmenu',this.onContextMenu);this.resize.disconnect();cancelAnimationFrame(this.frame);cancelAnimationFrame(this.gestureFrame);this.gestureFrame=0;document.removeEventListener('visibilitychange',this.refresh);this.reducedMotion.removeEventListener('change',this.refresh);for(const img of Object.values(this.images)){img.onload=null;img.onerror=null;}for(const [name,fn]of [['pointerdown',this.onPointerDown],['pointermove',this.onPointerMove],['pointerup',this.onPointerEnd],['pointercancel',this.onPointerEnd],['lostpointercapture',this.onPointerEnd],['wheel',this.onWheel]])this.canvas.removeEventListener(name,fn);}
  sprite(id,sx,sy,sw,sh,x,y,w,h){
    const img=this.images[id];if(!img?.complete||!img.naturalWidth)return false;
    this.ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h);return true;
  }
  ensureSealAtlas(){
    // Only sealing battles request this 73 KB atlas; other battle modes keep
    // their current image startup costs unchanged. Failed loads use vector art.
    if(this.images.seals||this.destroyed)return;
    const img=new Image();this.images.seals=img;
    img.decoding='async';
    img.onload=()=>{if(!this.destroyed)this.requestDraw();};
    img.onerror=()=>{if(!this.destroyed)this.requestDraw();};
    img.src=SEAL_ATLAS;
  }
  ensureGuardianAtlas(){
    if(this.images.guardian||this.destroyed)return;
    const img=new Image();this.images.guardian=img;img.decoding='async';
    img.onload=()=>{if(!this.destroyed)this.requestDraw();};
    img.onerror=()=>{if(!this.destroyed)this.requestDraw();};
    img.src=GUARDIAN_ATLAS;
  }
  drawFlyingSword(p,color,opacity=1,angle=Math.PI/5){
    const c=this.ctx,cell=this.cell,x=this.ox+(p.x+.5)*cell,y=this.oy+(p.y+.28)*cell;
    c.save();
    c.translate(x,y);c.rotate(angle);c.globalAlpha=opacity;
    c.shadowBlur=cell*.13;c.shadowColor=color;
    // Long, faceted blade with a bright cutting edge rather than a flat arrow.
    c.fillStyle=color;c.beginPath();
    c.moveTo(0,-cell*.34);c.lineTo(cell*.055,-cell*.18);c.lineTo(cell*.052,cell*.11);
    c.lineTo(0,cell*.145);c.lineTo(-cell*.052,cell*.11);c.lineTo(-cell*.055,-cell*.18);c.closePath();c.fill();
    c.fillStyle='#f5fffc';c.beginPath();c.moveTo(0,-cell*.34);c.lineTo(0,cell*.12);
    c.lineTo(-cell*.041,cell*.085);c.lineTo(-cell*.042,-cell*.16);c.closePath();c.fill();
    c.strokeStyle=color;c.lineWidth=Math.max(1.5,cell*.035);c.lineCap='round';c.beginPath();
    c.moveTo(-cell*.105,cell*.115);c.lineTo(0,cell*.15);c.lineTo(cell*.105,cell*.115);
    c.moveTo(0,cell*.15);c.lineTo(0,cell*.265);c.stroke();
    c.fillStyle='#f5fffc';c.beginPath();c.arc(0,cell*.27,Math.max(1,cell*.025),0,Math.PI*2);c.fill();
    c.restore();
  }
  drawEffect(scene,p,above){
    const c=this.ctx,size=this.cell,{ox,oy}=this,beat=Math.sin(Math.PI*p),color=scene.color||'#e6ca8c';
    const center=a=>({x:ox+(a.x+.5)*size,y:oy+(a.y+.45)*size});
    const actor=scene.before.find(a=>a.uid===scene.actor),origin=scene.origin||actor||{x:3,y:3},target=scene.target||origin;
    const from=center(origin),to=center(target),cells=scene.cells||[];
    const ring=(pt,r,alpha=1,ink=color)=>{c.globalAlpha=alpha;c.strokeStyle=ink;c.lineWidth=Math.max(1.2,size*.045);c.beginPath();c.arc(pt.x,pt.y,Math.max(1,r*size),0,Math.PI*2);c.stroke();};
    const motes=(pt,ink=color,count=10,radius=.8)=>{
      c.fillStyle=ink;
      for(let i=0;i<count;i++){
        const angle=i*2.39996,travel=(.15+p*radius)*size;c.globalAlpha=(1-p)*(.5+i%3*.15);
        c.beginPath();c.arc(pt.x+Math.cos(angle)*travel,pt.y+Math.sin(angle)*travel-p*size*.3,Math.max(1,size*.028),0,Math.PI*2);c.fill();
      }
    };
    const beam=(a,b,ink=color,lightning=false)=>{
      c.globalAlpha=beat*.9;c.strokeStyle=ink;c.lineWidth=Math.max(1.6,size*(lightning?.06:.04));c.beginPath();c.moveTo(a.x,a.y);
      const steps=lightning?7:1;for(let i=1;i<=steps;i++){
        const t=i/steps,jitter=i===steps?0:Math.sin(i*17.3)*size*.13;
        c.lineTo(a.x+(b.x-a.x)*t+jitter,a.y+(b.y-a.y)*t-jitter);
      }c.stroke();
    };
    c.save();c.beginPath();c.rect(ox,Math.max(0,oy-size*.35),size*this.state.width,size*(this.state.height+.35));c.clip();
    const view={cell:size,ox,oy,width:this.state.width,height:this.state.height};
    const manualCast=SkillEffects.draw(c,scene.weaponTimeline?{...scene,reducedMotion:this.reducedMotion.matches}:scene,p,view,above);
    if(scene.weaponTimeline&&manualCast){
      if(above)globalThis.QAWeaponEffects.drawNumbers(c,scene.weaponTimeline,p,view,scene.before);
      c.restore();return;
    }
    const impact=scene.parallelImpact?Math.max(0,Math.min(1,(p-scene.impactStart)/(1-scene.impactStart))):p;
    if(!above){
      if(!manualCast&&['cast','impact'].includes(scene.kind))for(const [i,cell]of cells.entries()){
        const at=center(cell),delay=scene.style==='line'?Math.min(.3,i*.06):0,q=Math.max(0,(p-delay)/(1-delay));
        c.globalAlpha=Math.sin(Math.PI*q)*.26;c.fillStyle=color;c.fillRect(ox+cell.x*size+1,oy+cell.y*size+1,size-2,size-2);
        if(q>0)ring(at,.15+q*.46,(1-q)*.65);
      }
      const manualMotion=scene.kind==='move'&&SkillEffects.drawMotion(c,scene,p,view);
      const advances=scene.moves.filter(move=>move.timing==='chain-advance');
      if(advances.length)SkillEffects.drawMotion(c,{...scene,kind:'move',style:'dash',visualSkill:scene.skill,moves:advances},p,view);
      const throws=scene.moves.filter(move=>move.timing==='manual-throw');
      if(throws.length)SkillEffects.drawMotion(c,{...scene,kind:'move',style:'throw',visualSkill:scene.skill,moves:throws},A.throwProgress(scene,p),view);
      if(scene.kind==='move'&&!manualMotion)for(const move of scene.moves){
        const route=move.path;
        if(scene.style==='teleport'){ring(center(route[0]),.15+p*.6,1-p);ring(center(route.at(-1)),.65-p*.4,p);}
        else{
          c.globalAlpha=(1-p)*.45;c.strokeStyle=color;c.lineWidth=size*(scene.style==='push'?.08:.05);c.setLineDash([size*.09,size*.08]);c.beginPath();
          route.forEach((pt,i)=>{const at=center(pt);c[i?'lineTo':'moveTo'](at.x,at.y);});c.stroke();c.setLineDash([]);
        }
      }
      if(scene.parallelImpact&&!scene.throwImpact&&impact>0){
        const sampled=A.sample(scene,p);
        for(const move of scene.moves.filter(m=>m.timing!=='chain-advance')){
          const current=sampled.find(a=>a.uid===move.uid);if(!current)continue;
          const start=center(move.path[0]),end=center(current);
          c.globalAlpha=(1-impact)*.55;c.strokeStyle=color;c.lineWidth=Math.max(2,size*.07);
          c.lineCap='round';c.beginPath();c.moveTo(start.x,start.y);c.lineTo(end.x,end.y);c.stroke();
        }
      }
      if(['restore','guard','answer','turn','dodge'].includes(scene.kind))ring(from,.25+p*.55,beat*.7,scene.kind==='restore'?'#b6d69c':scene.kind==='answer'?'#e9d28c':color);
      c.restore();return;
    }
    if(!manualCast&&['cast','impact'].includes(scene.kind)){
      const style=scene.style,lightning=scene.skill==='lightning'||scene.skill==='counter';
      if(scene.kind==='impact'){
        for(const cell of cells){const pt=center(cell),fall=Math.min(1,p/.65),head={x:pt.x-size*(1-fall)*.6,y:pt.y-(1-fall)*size*2.5};
          beam({x:head.x-size*.25,y:head.y-size*.65},head,'#dfb8ed');
          c.globalAlpha=1-p*.55;c.fillStyle='#f5d4ac';c.beginPath();c.arc(head.x,head.y,size*.11,0,Math.PI*2);c.fill();
          if(p>.5){ring(pt,(p-.5)*1.4,(1-p)*1.5,'#efd7a3');motes(pt,'#cfb7e7',5,.65);}
        }
      }else if(style==='flying-sword'){
        beam(from,to,'#d1efe1');ring(to,.22+beat*.25,beat,'#d1efe1');
      }else if(style==='sword-array'){
        for(const ray of scene.rays||[])beam(center(ray.at(-1)),to);
        ring(to,.2+beat*.35,beat);
      }else if(style==='fist-focus'){
        ring(from,.24+p*.55,beat,'#f4d38e');motes(from,'#f4d38e',16,.65);
      }else if(['fist-throw','fist-sweep','fist-chain'].includes(style)){
        for(const cell of cells){
          const pt=center(cell);ring(pt,.16+p*.38,beat,color);motes(pt,color,4,.46);
        }
      }else if(style==='dash-cleave'){
        const dx=to.x-from.x,dy=to.y-from.y;
        for(const cell of cells)ring(center(cell),.18+beat*.28,beat);
        for(let strike=0;strike<(scene.hits||1);strike++){
          const phase=Math.max(0,Math.min(1,p*2-strike)),wave=Math.sin(Math.PI*phase);
          if(!wave||!cells.length)continue;
          c.globalAlpha=wave;c.strokeStyle=color;c.lineWidth=size*.08;c.beginPath();
          const ends=[center(cells[0]),center(cells.at(-1))];
          const turn=Math.atan2(dy,dx);
          const skew=.22*size*(1-2*strike),sx=Math.sin(turn)*skew,sy=Math.cos(turn)*skew;
          c.moveTo(ends[0].x-sx,ends[0].y-sy);c.quadraticCurveTo(to.x,to.y-size*.46,ends[1].x+sx,ends[1].y+sy);c.stroke();
        }
      }else if(style==='meteor'){
        for(const cell of cells){const pt=center(cell);ring(pt,.2+beat*.15,beat);c.globalAlpha=beat;c.fillStyle='#e0c5f5';c.fillRect(pt.x-1,pt.y-size*.34,2,size*.2);}
      }else if(lightning){
        for(const cell of cells){const pt=center(cell);beam({x:pt.x+size*.25,y:pt.y-size*1.5},pt,'#e6c9ff',true);motes(pt,'#dbc1ef',5,.5);}
        ring(from,.35+beat*.15,beat,'#dfbded');
      }else if(['restore','counter','blink','swap'].includes(style)){
        ring(from,.28+p*.48,beat);motes(from,color,12,.7);
        if(style==='blink'||style==='swap'){ring(to,.7-p*.3,beat);motes(to,color,8,.7);}
      }else if(['cross','blast','shell','ring','nova','diagonal','area'].includes(style)){
        for(const cell of cells){const pt=center(cell);ring(pt,.12+p*.45,beat*.8);motes(pt,color,4,.42);}
        if(style==='shell'||style==='cross')ring(from,.2+p*(style==='shell'?2.5:1.5),1-p);
        if(style==='blast')for(const cell of cells)beam(from,center(cell),color);
      }else if(['cone','fork','line','shot','hit','charge','lunge'].includes(style)){
        if(['attack','blades','lunge','execute'].includes(scene.skill)){
          const angle=Math.atan2(to.y-from.y,to.x-from.x);
          for(const [i,cell]of cells.entries()){
            const pt=center(cell),q=Math.max(0,Math.min(1,(p-i*.06)/.8));c.globalAlpha=Math.sin(Math.PI*q);c.strokeStyle=color;c.lineWidth=size*.07;
            c.beginPath();c.arc(pt.x,pt.y,size*(.24+q*.2),angle-1.35+q*.7,angle+.2+q*.7);c.stroke();
          }
        }else{
          for(const cell of cells){const pt=center(cell),travel=Math.min(1,p/.65);beam(from,{x:from.x+(pt.x-from.x)*travel,y:from.y+(pt.y-from.y)*travel},color);}
          if(p>.35)motes(to,color,8,.55);
          if(scene.skill==='drain'){
            const q=Math.max(0,(p-.4)/.6);for(let i=0;i<4;i++){c.globalAlpha=beat;c.fillStyle='#b6d69c';c.beginPath();c.arc(to.x+(from.x-to.x)*q+Math.sin(q*6+i)*size*.08,to.y+(from.y-to.y)*q,size*.04,0,Math.PI*2);c.fill();}
          }
        }
      }else{
        // Bites, claws, pounces and wing cuts share the exact warned footprint.
        for(const cell of cells){const pt=center(cell);c.globalAlpha=beat;c.strokeStyle=color;c.lineWidth=Math.max(1.5,size*.045);
          for(let n=-1;n<=1;n++){c.beginPath();c.moveTo(pt.x-size*.28+n*size*.14,pt.y-size*.28);c.lineTo(pt.x+size*.12+n*size*.14,pt.y+size*.2);c.stroke();}
        }
      }
    }
    if(['restore','answer','guard','dodge'].includes(scene.kind)){
      const ink=scene.kind==='restore'?'#bddb9d':scene.kind==='answer'?'#efdc9d':color;motes(from,ink,scene.kind==='guard'?8:12,.75);
      if(scene.kind==='guard'){
        c.globalAlpha=beat;c.strokeStyle=ink;c.lineWidth=size*.05;c.beginPath();c.moveTo(from.x,from.y-size*.48);c.lineTo(from.x+size*.3,from.y-size*.3);c.lineTo(from.x+size*.24,from.y+size*.1);c.lineTo(from.x,from.y+size*.32);c.lineTo(from.x-size*.24,from.y+size*.1);c.lineTo(from.x-size*.3,from.y-size*.3);c.closePath();c.stroke();
      }
    }
    const numberActors=scene.parallelImpact?A.sample(scene,p):scene.before;
    if(scene.kind==='damage'||scene.parallelImpact&&impact>0){
      if(scene.style==='counter')beam(from,to,'#e0baf1',true);
      const impactActors=scene.throwImpact?numberActors:scene.before;
      for(const number of scene.strikeImpacts?[]:scene.numbers){const a=impactActors.find(a=>a.uid===number.uid);if(a)motes(center(a),number.absorbed?'#b9e5ef':'#efb18e',8,.7);}
      for(const reflection of scene.reflections||[]){
        const source=scene.before.find(a=>a.uid===reflection.actor),victim=scene.before.find(a=>a.uid===reflection.target);
        if(source&&victim)beam(center(source),center(victim),'#e0baf1',true);
      }
    }
    const numbers=scene.strikeImpacts?scene.strikeImpacts.flatMap((hits,index)=>{
      const elapsed=p-A.strikeTime(scene,index);
      if(elapsed<0||elapsed>=.28)return [];
      return hits.map(hit=>({...hit,numberProgress:elapsed/.28}));
    }):scene.parallelImpact&&impact===0?[]:[...scene.numbers];
    if(scene.kind==='dodge'&&actor)numbers.push({uid:actor.uid,text:'閃避'});
    for(const number of numbers){
      const a=numberActors.find(a=>a.uid===number.uid);if(!a)continue;
      const at=center(a),lines=globalThis.QABattlePresentation.eventLines(number);
      const numberProgress=number.numberProgress??impact;
      c.globalAlpha=Math.min(1,(1-numberProgress)*3);c.font=`600 ${Math.max(10,Math.min(17,size*.32))}px "Noto Sans TC",sans-serif`;c.textAlign='center';c.textBaseline='middle';c.lineWidth=3;
      for(const [i,line]of lines.entries()){
        const half=c.measureText(line.text).width/2+3,x=Math.max(ox+half,Math.min(ox+size*this.state.width-half,at.x)),y=Math.max(oy+10,at.y-size*(.55+numberProgress*.6)+i*15);
        c.strokeStyle='#231a13';c.strokeText(line.text,x,y);c.fillStyle=line.ink;c.fillText(line.text,x,y);
      }
    }
    if(scene.kind==='finish'){
      const pt={x:ox+this.state.width*size/2,y:oy+this.state.height*size/2},ink=scene.style==='victory'?'#e7ca89':'#cfb99b';
      ring(pt,.5+p*2,beat*.6,ink);motes(pt,ink,22,2.5);
      c.globalAlpha=beat;c.fillStyle='#211b14d9';c.fillRect(pt.x-size*2,pt.y-size*.5,size*4,size);
      c.fillStyle=ink;c.font=`500 ${Math.min(30,size*.6)}px "Noto Serif TC",serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(scene.label,pt.x,pt.y);
    }
    c.restore();
  }
  // Matches the dungeon's persistent Canvas fallback: the halo surrounds
  // the character instead of tinting or covering its sprite.
  drawFocusHalo(c,x,y,cell){
    const radius=Math.max(10,Math.min(31,cell*.56));
    c.save();
    c.strokeStyle='#ffe097';c.lineWidth=Math.max(2,Math.min(4,cell*.09));
    c.shadowColor='#ffc252';c.shadowBlur=Math.max(7,Math.min(22,cell*.32));
    c.globalAlpha=.94;
    c.beginPath();c.arc(x,y,radius,0,Math.PI*2);c.stroke();
    c.shadowBlur=0;c.fillStyle='#fff1ad';c.globalAlpha=.9;
    for(const angle of [-Math.PI*.62,-Math.PI*.13,Math.PI*.37,Math.PI*.85]){
      c.beginPath();c.arc(x+Math.cos(angle)*radius,y+Math.sin(angle)*radius,
        Math.max(1.5,Math.min(3.4,cell*.068)),0,Math.PI*2);c.fill();
    }
    c.restore();
  }
  // CSS aura, identical to the cooperative dungeon's glow/flames/orbit/motes.
  // Its position is derived from the same camera coordinates as Canvas actors;
  // no visual state is ever used for combat authority.
  updateFocusAuras(geometry,actors,now){
    const layer=this.canvas.parentElement?.querySelector('[data-focus-layer]');
    if(!layer||!geometry)return;
    const present=new Set(),state=this.state;
    if(!this.preview&&state?.mode==='pve'&&state.status==='active'){
      for(const actor of actors){
        const authentic=state.actors.find(a=>a.uid===actor.uid);
        const remaining=authentic?R.focusTurns(authentic):0;
        if(!remaining||!R.alive(authentic)||actor.bot||
            !Number.isFinite(actor.x)||!Number.isFinite(actor.y))continue;
        const cell=geometry.cell;
        const pose=Ambience.idlePose(actor,now,
          !this.ambience||this.reducedMotion.matches||this.isAnimating);
        const x=geometry.ox+(actor.x+.5+(actor.sway||0))*cell+(pose?.dx||0)*cell;
        const groundY=geometry.oy+(actor.y+.5)*cell;
        const y=Math.max(cell*.82,groundY-(actor.lift||0)*cell)+(pose?.dy||0)*cell;
        const bounds=this.canvas.getBoundingClientRect();
        if(x< -80||y< -80||x>bounds.width+80||y>bounds.height+80)continue;
        present.add(actor.uid);
        let aura=this.focusAuras.get(actor.uid);
        if(!aura){
          aura=document.createElement('div');aura.className='dm-focus-aura';
          aura.dataset.focusUid=actor.uid;
          aura.innerHTML='<span class="dm-focus-glow"></span>'+
            '<span class="dm-focus-flames"></span>'+
            '<span class="dm-focus-ring"></span>'+
            '<span class="dm-focus-orbit"></span>'+
            '<span class="dm-focus-spark dm-spark-a"></span>'+
            '<span class="dm-focus-spark dm-spark-b"></span>'+
            '<span class="dm-focus-spark dm-spark-c"></span>'+
            '<span class="dm-focus-spark dm-spark-d"></span>'+
            '<span class="dm-focus-spark dm-spark-e"></span>'+
            '<span class="dm-focus-spark dm-spark-f"></span>'+
            '<span class="dm-focus-count"></span>';
          this.focusAuras.set(actor.uid,aura);layer.append(aura);
        }
        aura.style.left=x+'px';aura.style.top=y+'px';
        aura.style.setProperty('--dm-focus-size',
          Math.max(58,Math.min(148,cell*2.05))+'px');
        aura.dataset.charges=String(remaining);
        aura.classList.toggle('is-self',actor.uid===this.uid);
        aura.querySelector('.dm-focus-count').textContent=
          actor.uid===this.uid?'蓄勢 '+remaining+'/2':'✦ '+remaining;
        aura.title='金身蓄勢 · 剩餘 '+remaining+' 回合';
      }
    }
    for(const [uid,aura]of this.focusAuras)if(!present.has(uid)){
      aura.remove();this.focusAuras.delete(uid);
    }
  }
  draw(){
    cancelAnimationFrame(this.frame);this.frame=0;
    cancelAnimationFrame(this.gestureFrame);this.gestureFrame=0;
    clearTimeout(this.ambientTimer);this.ambientTimer=null;
    if(this.destroyed||!this.state)return;
    const now=performance.now();
    if(this.paused||document.hidden){this.heldAt??=now;return;}
    if(this.heldAt!==null){const pausedFor=now-this.heldAt;if(this.scene)this.scene.started+=pausedFor;
      for(const cue of this.objectiveCues||[])if(cue.started!=null)cue.started+=pausedFor;
      this.heldAt=null;}
    if(this.reducedMotion.matches&&this.isAnimating){this.queue=[];this.scene=null;this.activity();}
    const progress=this.preview?this.preview.progress:this.advance(now),scene=this.preview?this.preview.scene:this.scene,animating=!!scene||this.isAnimating;
    const {canvas,ctx:c,state:s}=this,rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const w=rect.width,h=rect.height;
    const dpr=Ambience.pixelRatioFor(w,h,window.devicePixelRatio||1,navigator.deviceMemory);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
    const view=this.preview?.view||{x:0,y:0,width:s.width,height:s.height};
    // The canvas fills the available area, but only actual map tiles are
    // painted: never mirror or repeat terrain outside the server's grid.
    const frameless=!this.preview&&!!canvas.closest('#tactical-combat.tc-quarter-layout');
    const g=Camera.geometry(this.camera,w,h,view);this.camera=Camera.normalize(this.camera,w,h,view);
    const cell=this.cell=g.cell,ox=this.ox=g.ox,oy=this.oy=g.oy;
    const mine=s.actors.find(a=>a.uid===this.uid),myTurn=!animating&&s.status==='active'&&s.turnUid===this.uid&&(!s.quizRound||s.phase==='action'),reduced=this.reducedMotion.matches;
    const cutImpact=reduced?null:A.crossCutImpact(scene,progress);
    const contact=!reduced&&!this.preview&&s.mode==='pve'?
      Impact.shake(scene,progress,A):0;
    const weight=!reduced&&scene?
      Math.max(cutImpact?.strength??A.impactPulse(scene,progress),contact):0;
    if(!this.preview&&s.mode==='pve'&&scene&&!reduced){
      // Once per committed impact beat, while preserving the player's
      // existing sound preferences and the audio manager's own cooldown.
      const prismPlayed=scene.weaponTimeline&&globalThis.QAWeaponEffects.advancePrismSound(scene.weaponTimeline,scene.skill,
        progress*scene.weaponTimeline.durationMs,scene._playedPrismCues||=new Set(),
        (id,opts)=>{try{window.QAGameAudio?.play(id,opts);}catch(_){}},s.id+':'+(scene.weaponGroup||scene.eventRevision)+':'+scene.actor);
      const bellPlayed=scene.weaponTimeline&&globalThis.QAWeaponEffects.advanceBellSound(scene.weaponTimeline,scene.skill,
        progress*scene.weaponTimeline.durationMs,scene._playedBellCues||=new Set(),
        (id,opts)=>{try{window.QAGameAudio?.play(id,opts);}catch(_){}},s.id+':'+(scene.weaponGroup||scene.eventRevision)+':'+scene.actor);
      const weavePlayed=scene.weaponTimeline&&globalThis.QAWeaponEffects.advanceWeaveSound(scene.weaponTimeline,scene.skill,
        progress*scene.weaponTimeline.durationMs,scene._playedWeaveCues||=new Set(),
        (id,opts)=>{try{window.QAGameAudio?.play(id,opts);}catch(_){}},s.id+':'+(scene.weaponGroup||scene.eventRevision)+':'+scene.actor);
      const timePlayed=scene.weaponTimeline&&globalThis.QAWeaponEffects.advanceTimeSound(scene.weaponTimeline,scene.skill,
        progress*scene.weaponTimeline.durationMs,scene._playedTimeCues||=new Set(),
        (id,opts)=>{try{window.QAGameAudio?.play(id,opts);}catch(_){}},s.id+':'+(scene.weaponGroup||scene.eventRevision)+':'+scene.actor);
      const windows=prismPlayed||bellPlayed||weavePlayed||timePlayed?[]:scene.weaponTimeline?[...new Set(scene.weaponTimeline.segments.filter(s=>s.hits.some(h=>h.damage||h.absorbed)).map(s=>s.impact))].slice(0,3).map(at=>({at:at/scene.weaponTimeline.durationMs})):Impact.hitWindows(scene,A);
      if(windows.length){
        scene._playedImpactCues||=new Set();
        for(let i=0;i<windows.length;i++){
          if(progress<windows[i].at||scene._playedImpactCues.has(i))continue;
          scene._playedImpactCues.add(i);
          try{window.QAGameAudio?.play('combat-impact',{volume:.27});}catch(_){}
        }
      }
    }
    if(weight){
      c.save();
      if(cutImpact){
        const direction=cutImpact.index===0?1:-1;
        const kick=Math.cos(cutImpact.phase*Math.PI*2)*Math.min(4.5,cell*.085)*weight;
        c.translate(direction*kick,kick*.55);
      }else{
        const q=(progress-(scene.impactStart??(scene.kind==='damage'?.12:.40)))/.22,amount=Math.min(2.5,cell*.05)*weight;
        c.translate(Math.sin(q*Math.PI*4)*amount,Math.cos(q*Math.PI*4)*amount*.45);
      }
    }
    const fill=(p,color,stroke)=>{const x=ox+p.x*cell,y=oy+p.y*cell;c.fillStyle=color;c.fillRect(x+1,y+1,cell-2,cell-2);if(stroke){c.strokeStyle=stroke;c.lineWidth=1.5;c.strokeRect(x+2,y+2,cell-4,cell-4);}};
    c.imageSmoothingEnabled=true;c.imageSmoothingQuality=w*h*dpr*dpr>2800000?'medium':'high';
    // Finite map: show only tiles within the actual battlefield dimensions.
    // The surrounding canvas stays empty for drag/zoom without fake terrain.
    for(let y=view.y;y<view.y+view.height;y++)for(let x=view.x;x<view.x+view.width;x++){
      const px=Math.round(ox+x*cell),py=Math.round(oy+y*cell),edgeX=Math.round(ox+(x+1)*cell),edgeY=Math.round(oy+(y+1)*cell),t=s.ground?.[y*s.width+x]??s.terrain;
      if(!this.sprite('ground',t%4*128,Math.floor(t/4)*128,128,128,px,py,edgeX-px,edgeY-py)){c.fillStyle=(x+y)%2?'#5b6650':'#5f6b53';c.fillRect(px,py,edgeX-px,edgeY-py);}
      c.strokeStyle='#10291b30';c.lineWidth=.7;c.strokeRect(px,py,edgeX-px,edgeY-py);
    }
    // Stone gate inscriptions are strictly decorative, below combat telegraphs.
    if(s.weaponDungeon?.id==='peak-stone'&&s.trial?.structure==='three-stone-gates'){
      c.save();c.strokeStyle='#dec69755';c.lineWidth=Math.max(1,cell*.035);
      for(const row of [16,10,4]){
        const x=ox+6.5*cell,y=oy+(row+.5)*cell;
        c.beginPath();c.moveTo(x-cell*1.12,y);c.lineTo(x,y-cell*.31);c.lineTo(x+cell*1.12,y);c.lineTo(x,y+cell*.31);c.closePath();c.stroke();
        c.beginPath();c.arc(x,y,cell*.20,0,Math.PI*2);c.stroke();
      }
      c.restore();
    }
    // Ambience is painted behind tactical ranges, red warnings and actors.
    // It cannot conceal danger telegraphs or create deceptive walkable tiles.
    const ambienceActive=s.mode==='pve'&&!this.preview&&!!this.ambience;
    if(ambienceActive){
      const visual={ox,oy,cell},quality=(cell<25||w*h>1350000)?'low':'normal';
      if(this.ambienceLayer)c.drawImage(this.ambienceLayer,ox,oy,cell*s.width,cell*s.height);
      else Ambience.drawDetails(c,this.ambience,visual);
      Ambience.drawAtmosphere(c,this.ambience,visual,now,reduced,quality);
    }
    if(s.mode==='pve'&&!this.preview){
      Impact.drawBossPresence(c,Impact.bossFor(s),{ox,oy,cell,width:s.width,height:s.height},now,reduced);
    }
    const objective=s.objective,markers=[];
    // Field auras are ground markings, below red telegraphs and target previews.
    if(!this.preview&&objective?.type==='sealing'&&s.trial?.layoutVersion===4)
      SealRanges.ground(c,this.sealRangePlan,{ox,oy,cell,width:s.width,height:s.height},
        this.sealRangeMode,this.sealRangeFocusId);
    if(objective?.type==='transport'){
      if(objective.item&&!objective.item.collected)markers.push({...objective.item,label:'物',color:'#f7d975'});
      if(objective.destination)markers.push({...objective.destination,label:'交',color:'#8ee6d0'});
    }else if(objective?.type==='defense')markers.push({...objective.shrine,label:'守',color:'#75e9b2'});
    else if(objective?.type==='sealing')for(const p of objective.points||[]){
      // Keep the existing compact marker until the image phase. Its label and
      // hue now come from the same authoritative catalog as combat and intel.
      // Layout-v3 activation markers intentionally retain their legacy style.
      const seal=R.sealInfo(s,p);
      markers.push({...p,seal,label:p.activated?'✓':seal?.label||'陣',
        color:p.activated?'#b5c4b7':seal?.color||'#a7e8ff'});
    }
    if(markers.some(p=>p.seal))this.ensureSealAtlas();
    if(objective?.type==='defense'&&s.trial?.layoutVersion===4)this.ensureGuardianAtlas();
    for(const p of objective?.hazards||[])fill(p,'#f24c4866','#ffb1a3');
    for(const p of markers){
      if(p.seal||objective?.type==='defense'&&s.trial?.layoutVersion===4)continue;
      // Sprite cores are drawn after ground warnings, before characters.
      const x=ox+(p.x+.5)*cell,y=oy+(p.y+.5)*cell;c.save();c.strokeStyle=p.color;c.fillStyle='#102b2bcc';c.lineWidth=Math.max(2,cell*.06);
      c.beginPath();c.arc(x,y,cell*.34,0,Math.PI*2);c.fill();c.stroke();c.fillStyle=p.color;c.font=`bold ${Math.max(10,cell*.3)}px system-ui`;c.textAlign='center';c.textBaseline='middle';c.fillText(p.label,x,y);c.restore();
      if(objective?.type==='defense'){
        const w=cell*.7,h=Math.max(3,cell*.07),left=x-w/2,top=y-cell*.47;
        c.fillStyle='#16271ddd';c.fillRect(left,top,w,h);c.fillStyle='#7ce8ad';c.fillRect(left,top,w*Math.max(0,Math.min(1,objective.hp/objective.maxHp)),h);
      }
    }
    const nextMarker=objective?.type==='transport'?(objective.carrying?markers.find(p=>p.label==='交'):markers.find(p=>p.label==='物')):objective?.type==='sealing'?markers.find(p=>p.label!=='✓'):null;
    if(nextMarker){
      const x=ox+(nextMarker.x+.5)*cell,y=oy+(nextMarker.y+.5)*cell,margin=20;
      if(x<margin||x>w-margin||y<margin||y>h-margin){
        const dx=x-w/2,dy=y-h/2,scale=Math.min((w/2-margin)/Math.max(Math.abs(dx),1),(h/2-margin)/Math.max(Math.abs(dy),1));
        c.save();c.translate(w/2+dx*scale,h/2+dy*scale);c.rotate(Math.atan2(dy,dx));c.fillStyle=nextMarker.color;c.beginPath();c.moveTo(8,0);c.lineTo(-6,-6);c.lineTo(-6,6);c.closePath();c.fill();c.restore();
      }
    }
    if(myTurn&&this.mode==='sword-move'){
      for(const p of this.range)fill(p,'#6bdedb38','#7efff2a6');
    }
    if(myTurn&&this.mode==='move'){
      // Absolute time keeps the same soft pulse at any refresh rate. The BFS is
      // cached by update(), rather than repeated on every animation frame.
      const alpha=reduced ? .4 : .18+.34*(.5+.5*Math.sin(now*2*Math.PI/1400));
      for(const p of this.range)fill(p,`rgba(128,128,128,${alpha})`,'#dadde18c');
    }
    if(myTurn&&(this.mode==='attack'||this.mode.startsWith('manual:'))){
      const plan=this.displaySkillPreview||this.skillPreview;
      for(const p of plan?.cells||[])fill(p,this.mode.startsWith('manual:weave-')?'#52b79528':'#e5c77326',this.mode.startsWith('manual:weave-')?'#79d9b988':'#e5cc8766');
      // Aims may be empty landing tiles or directions, not damage tiles.
      for(const p of plan?.aims||[])fill(p,'#fff0','#e5cc87a6');
      if(plan?.first)fill(plan.first,'#6ce9bc55','#bcffe9');
      for(const p of Object.values(plan?.byAim||{}).flatMap(v=>[...(v.mirrorSteps||[]),...(v.mirrorPlan?.parts||[]).filter(q=>q.avatar)].flatMap(q=>q.cells)))fill(p,'#9a7ce832','#b49aee77');
      const aim=this.hoverSelection||(!this.selection?.choosing?this.selection:null);
      const preview=aim&&plan?.byAim[R.key(aim)];
      if(preview){
        for(const p of preview.path.slice(1))fill(p,'#e9cf813b','#e5cc87');
        for(const p of preview.cells)fill(p,preview.weavePlan?'#4bd3a966':'#e9ba5266',preview.weavePlan?'#b4ffe0':'#ffe3a4');
        for(const p of [...(preview.mirrorSteps||[]),...(preview.mirrorPlan?.parts||[]).filter(q=>q.avatar)].flatMap(q=>q.cells))fill(p,'#a18ae866','#d9c3ff');
        for(const ray of preview.rays||[])if(ray.depth>0)for(const p of ray.cells)fill(p,ray.depth===1?'#eea45b44':'#b49ae744',ray.depth===1?'#ffc58c':'#d2bcff');
        c.save();c.setLineDash([Math.max(2,cell*.1),Math.max(2,cell*.06)]);
        for(const p of preview.landings)fill(p,'#fff0','#ffe8a6');
        c.restore();
      }
    }
    if(myTurn&&this.mode==='sword-move'&&this.selection&&mine?.flyingSword){
      const route=R.swordRoute(s,mine,this.selection);
      if(route?.length>1){
        c.save();c.beginPath();
        route.forEach((p,i)=>c[i?'lineTo':'moveTo'](ox+(p.x+.5)*cell,oy+(p.y+.5)*cell));
        c.strokeStyle='#7efff2';c.lineWidth=Math.max(2,cell*.075);
        c.setLineDash([cell*.17,cell*.12]);c.stroke();c.setLineDash([]);c.restore();
        for(const p of route.slice(1))if(s.actors.some(t=>R.alive(t)&&t.team!==mine.team&&R.covers(t,p)))
          fill(p,'#f6a36c44','#ffbd7d');
      }
    }
    if(!animating){
      for(const e of s.effects)for(const p of e.cells)fill(p,'#9b7aec55','#d5b8ff');
      if(s.mode==='pve')Threats.drawGround(c,this.threatPlan,
        {ox,oy,cell,width:s.width,height:s.height});
      else{
        c.setLineDash([3,3]);
        for(const a of s.actors.filter(a=>a.bot&&R.alive(a)))
          for(const p of a.intent?.cells||[])fill(p,'#e2564518','#ff8871');
        c.setLineDash([]);
      }
    }
    if(myTurn&&this.mode==='move'&&s.mode==='pve'&&!animating)
      Targets.drawRoute(c,this.hoverPlan||this.targetPlan,{ox,oy,cell,width:s.width,height:s.height});
    else if(myTurn&&this.mode==='move'&&this.selection){
      const route=R.path(s,mine,this.selection,mine.uid);if(route&&route.length>1){
        c.beginPath();route.forEach((p,i)=>c[i?'lineTo':'moveTo'](ox+(p.x+.5)*cell,oy+(p.y+.5)*cell));
        c.strokeStyle='#f8df9b';c.lineWidth=2.5;c.setLineDash([4,4]);c.stroke();c.setLineDash([]);
      }
    }
    for(const p of s.blocks){
      if(p.kind==='water')continue;
      const x=ox+p.x*cell,y=oy+p.y*cell;fill(p,'#1c261b60');
      // Anchor visual depth beneath immovable trees and rocks, never over paths.
      if(ambienceActive){
        c.save();c.fillStyle='rgba(9,19,13,.24)';c.beginPath();
        c.ellipse(x+cell*.59,y+cell*.86,cell*.48,cell*.16,-.08,0,Math.PI*2);
        c.fill();c.restore();
      }
      let propDrawn=false;
      if(ambienceActive&&p.kind==='tree'&&!reduced){
        // A small canopy movement pivots around the grounded trunk.
        c.save();c.translate(x+cell*.5,y+cell*.85);
        c.rotate(.012*Math.sin(now*.0012+p.x*1.3+p.y*.87));
        propDrawn=this.sprite('props',128,0,128,128,-cell*.56,-cell,cell*1.12,cell*1.12);
        c.restore();
      }else propDrawn=this.sprite('props',(p.kind==='tree'?1:2)*128,0,128,128,x-cell*.06,y-cell*.15,cell*1.12,cell*1.12);
      if(!propDrawn){
        c.fillStyle='#56594c';c.fillRect(x+cell*.14,y+cell*.1,cell*.72,cell*.8);
      }
    }
    // Gates and current hazard marks are above terrain props but below the
    // red hazard contours, player/monster sprites and their HP labels.
    if(!this.preview&&objective?.type==='sealing'&&s.trial?.layoutVersion===4)
      SealRanges.details(c,this.sealRangePlan,{ox,oy,cell,width:s.width,height:s.height},
        this.sealRangeMode,this.sealRangeFocusId);
    // Tactical warnings, skill reach and target rings are ground markings.
    // Paint their complete outlines before any actor sprite, status icon or
    // HP bar so neither heroes nor beasts can be crossed by a range frame.
    // The paint order is: terrain > warnings/selection > actors > hit VFX.
    if(this.selection&&!animating)fill(this.selection,'#fff0','#fff1ba');
    if(myTurn&&s.mode==='pve'&&!animating)
      Targets.drawFocus(c,this.hoverPlan||this.targetPlan,{ox,oy,cell,width:s.width,height:s.height});
    if(!animating&&s.mode==='pve'){
      const viewport={ox,oy,cell,width:s.width,height:s.height};
      Threats.drawContours(c,this.threatPlan,viewport);
      if(myTurn&&this.mode==='move')
        Threats.drawGuidance(c,this.threatPlan,viewport,reduced);
    }
    // The newcomer guide highlights the ONE intended tile, not the whole
    // movement range. It sits beneath actors and health bars, so the target
    // glow cannot cover the hero or spirit beast.
    const tutorialGuideStep=!this.preview&&s.mode==='pve'&&s.trial?.stage===1
      ? window.firstAnswerGuideStep?.(this.uid) : -1;
    const guideTarget=tutorialGuideStep===5?R.TUTORIAL_STAGE1?.move:
      tutorialGuideStep===7?R.TUTORIAL_STAGE1?.enemy:null;
    if(guideTarget&&!animating){
      const x=ox+guideTarget.x*cell,y=oy+guideTarget.y*cell;
      const alpha=reduced?.95:.68+.25*(.5+.5*Math.sin(now/330));
      c.save();
      c.strokeStyle='rgba(255,217,128,'+alpha.toFixed(3)+')';
      c.lineWidth=Math.max(2.5,cell*.082);
      c.shadowColor='#f5c768';c.shadowBlur=cell*.23;
      c.strokeRect(x+cell*.12,y+cell*.12,cell*.76,cell*.76);
      c.shadowBlur=0;
      c.fillStyle='rgba(255,210,116,.14)';
      c.fillRect(x+cell*.14,y+cell*.14,cell*.72,cell*.72);
      c.restore();
    }
    // Edge navigation badges are drawn below all characters and HP text.
    // They do not affect the threat, skill range or grid hit-testing rules.
    this.compassMarkers=!animating&&!this.preview?
      Compass.derive(s,this.uid,{ox,oy,cell,width:w,height:h}):[];
    canvas.dataset.compassCount=String(this.compassMarkers.length);
    canvas.dataset.compassMarkers=JSON.stringify(this.compassMarkers.map(m=>
      [m.kind,Math.round(m.screenX),Math.round(m.screenY)]));
    Compass.draw(c,this.compassMarkers,{width:w,height:h});
    const actors=scene?A.sample(scene,progress):s.actors;
    globalThis.QAWeaponEffects?.drawObjects(c,s.weaponObjects,actors,{ox,oy,cell,width:s.width,height:s.height},now,{reduced,blocked:p=>R.blocked(s,p),summoningOwners:scene?.skill==='mirror-summon'?[scene.actor]:[],timeBirths:scene?.skill==='time-slash'?scene.weaponTimeline?.segments.filter(q=>q.timeBirth).map(q=>({uid:scene.actor,...q.origin}))||[]:[]});
    if(scene)this.drawEffect(scene,progress,false);
    // A dedicated guardian altar replaces the old '守' circle in v4 defense.
    // The same authoritative objective.hp/maxHp controls sprite damage state
    // and the legible bar. We keep the fallback if loading is delayed or fails.
    if(objective?.type==='defense'&&s.trial?.layoutVersion===4&&objective.shrine){
      const p=objective.shrine,x=ox+(p.x+.5)*cell,y=oy+(p.y+.5)*cell;
      const frame=ObjectiveVFX.guardianFrame(objective);
      const size=cell*(cell<27?1.14:1.28);
      const painted=this.sprite('guardian',frame*GUARDIAN_FRAME_SIZE,0,
        GUARDIAN_FRAME_SIZE,GUARDIAN_FRAME_SIZE,x-size/2,y-size*.61,size,size);
      if(!painted){
        c.save();c.strokeStyle='#94edc5';c.fillStyle='#102e27df';
        c.lineWidth=Math.max(2,cell*.06);c.beginPath();
        c.arc(x,y,cell*.34,0,Math.PI*2);c.fill();c.stroke();
        c.fillStyle='#b7f7d2';c.font=`bold ${Math.max(10,cell*.3)}px system-ui`;
        c.textAlign='center';c.textBaseline='middle';c.fillText('守',x,y);c.restore();
      }
      const fraction=objective.maxHp>0?Math.max(0,Math.min(1,objective.hp/objective.maxHp)):0;
      const barWidth=Math.max(24,cell*.78),barHeight=Math.max(3,cell*.083),
        barX=x-barWidth/2,barY=y-cell*.48;
      c.save();c.fillStyle='#10231bdb';c.fillRect(barX-1,barY-1,barWidth+2,barHeight+2);
      c.fillStyle=fraction>.5?'#83e8bb':fraction>0?'#efba7c':'#ab8f89';
      c.fillRect(barX,barY,barWidth*fraction,barHeight);
      if(cell>=32){
        c.fillStyle='#e1fff0';c.font=`600 ${Math.max(9,cell*.18)}px system-ui`;
        c.textAlign='center';c.textBaseline='bottom';
        c.fillText('靈陣 '+Math.ceil(Math.max(0,objective.hp))+'/'+objective.maxHp,x,barY-3);
      }
      c.restore();
    }
    // Seal art: keep the floor glyph and floating crystal below every hero,
    // beast and HP label while preserving all combat telegraph outlines.
    if(objective?.type==='sealing'&&s.trial?.layoutVersion===4){
      for(const p of markers){
        const seal=p.seal;if(!seal)continue;
        const x=ox+(p.x+.5)*cell,y=oy+(p.y+.5)*cell;
        const column=R.SEAL_KINDS.indexOf(seal.kind);
        const row=seal.broken||seal.hp<=0?2:seal.hp<seal.maxHp?1:0;
        const size=cell*(cell<27?1.10:1.22);
        c.save();
        if(seal.broken)c.globalAlpha=.88;
        const painted=column>=0&&this.sprite('seals',column*SEAL_FRAME_SIZE,
          row*SEAL_FRAME_SIZE,SEAL_FRAME_SIZE,SEAL_FRAME_SIZE,
          x-size/2,y-size*.59,size,size);
        c.restore();
        if(!painted){
          // During image loading / network failure the existing readable icon
          // remains available, including the same color and destroyed check.
          c.save();c.strokeStyle=p.color;c.fillStyle='#102b2bdd';
          c.lineWidth=Math.max(2,cell*.06);c.beginPath();c.arc(x,y,cell*.34,0,Math.PI*2);
          c.fill();c.stroke();c.fillStyle=p.color;
          c.font=`bold ${Math.max(10,cell*.3)}px system-ui`;
          c.textAlign='center';c.textBaseline='middle';c.fillText(p.label,x,y);c.restore();
        }else if(!seal.broken&&cell>=26){
          // Two quiet durability insets distinguish 2/2 from 1/2 at a glance.
          const bars=Math.max(1,Math.min(4,Math.round(seal.maxHp)));
          const pip=cell*.115,gap=Math.max(2,cell*.035);
          const left=x-(bars*pip+(bars-1)*gap)/2;
          for(let i=0;i<bars;i++){
            const px=left+i*(pip+gap),py=y+cell*.44;
            c.fillStyle='#142629dc';c.fillRect(px-1,py-1,pip+2,Math.max(3,cell*.065)+2);
            c.fillStyle=i<seal.hp?seal.color:'#667577';
            c.fillRect(px,py,pip,Math.max(2,cell*.065));
          }
        }
      }
    }
    // Play the committed hit / shatter / dispersal effects AFTER game animations
    // and BEFORE heroes and beasts, never obscuring units or warning tiles.
    const objectiveFxActive=!this.preview&&!animating?
      ObjectiveVFX.draw(c,this.objectiveCues,now,
        {ox,oy,cell,width:s.width,height:s.height},reduced):false;
    // Quiet attackable emblems + exact durability above the altar art and
    // BELOW every character sprite. Ready is shown only when real skill
    // geometry and server-side resource validation both allow an action.
    if(!this.preview&&objective?.type==='sealing'&&s.trial?.layoutVersion===4){
      for(const seal of this.sealTargetPlan.seals){
        if(seal.broken)continue;
        const x=ox+(seal.x+.5)*cell,y=oy+(seal.y+.5)*cell;
        const ready=seal.status==='ready'&&!animating;
        const size=Math.max(4.2,Math.min(8,cell*.16));
        const cx=x+cell*.31,cy=y-cell*.28;
        c.save();c.fillStyle=ready?'#173f34ec':'#152c2de0';
        c.strokeStyle=ready?'#acf4cf':seal.color;
        c.lineWidth=Math.max(1.2,cell*.031);
        c.beginPath();c.arc(cx,cy,size,0,Math.PI*2);c.fill();c.stroke();
        // Four ticks and a center dot read as a target even when tiny.
        c.beginPath();
        c.moveTo(cx-size*.7,cy);c.lineTo(cx-size*.28,cy);
        c.moveTo(cx+size*.28,cy);c.lineTo(cx+size*.7,cy);
        c.moveTo(cx,cy-size*.7);c.lineTo(cx,cy-size*.28);
        c.moveTo(cx,cy+size*.28);c.lineTo(cx,cy+size*.7);
        c.stroke();c.beginPath();c.arc(cx,cy,Math.max(.7,size*.11),0,Math.PI*2);
        c.fillStyle=ready?'#dffff1':seal.color;c.fill();
        if(cell>=25){
          const label=seal.hp+'/'+seal.maxHp,tw=Math.max(cell*.45,24),th=Math.max(11,cell*.2);
          c.fillStyle='#12221fe8';c.fillRect(x-tw/2,y+cell*.40,tw,th);
          c.fillStyle=ready?'#c9ffe0':'#e0ebdd';
          c.font='600 '+Math.max(9,Math.min(13,cell*.19))+'px system-ui';
          c.textAlign='center';c.textBaseline='middle';
          c.fillText(label,x,y+cell*.40+th/2);
        }
        c.restore();
      }
    }

    const positions=actors.filter(R.alive).sort((a,b)=>a.y-b.y);
    const focusedIds=new Set(s.mode==='pve'&&s.status==='active'?
      s.actors.filter(a=>R.alive(a)&&!a.bot&&R.focusTurns(a)>0).map(a=>a.uid):[]);
    for(const a of positions){
      const {x,y}=a;
      const sizeFactor=a.boss?2:1;
      const px=ox+(x+sizeFactor/2+(a.sway||0))*cell,groundY=oy+(y+sizeFactor/2)*cell,py=Math.max(cell*.82,groundY-(a.lift||0)*cell),own=a.uid===this.uid,enemy=a.team!==mine?.team;
      const pose=Ambience.idlePose(a,now,!ambienceActive||reduced||animating);
      const actorPx=px+pose.dx*cell,actorPy=py+pose.dy*cell;
      c.save();c.globalAlpha=a.opacity??1;
      c.beginPath();c.ellipse(px,groundY+cell*.18,cell*.28*sizeFactor,cell*.12*sizeFactor,0,0,Math.PI*2);c.fillStyle='#0005';c.fill();
      if(ambienceActive&&own){
        const halo=c.createRadialGradient(px,groundY,cell*.1,px,groundY,cell*.63);
        halo.addColorStop(0,'rgba(180,222,176,.13)');
        halo.addColorStop(1,'rgba(180,222,176,0)');
        c.fillStyle=halo;c.beginPath();c.ellipse(px,groundY,cell*.63,cell*.43,0,0,Math.PI*2);c.fill();
      }
      if(focusedIds.has(a.uid))this.drawFocusHalo(c,actorPx,actorPy,cell);
      c.strokeStyle=own?'#f8d58a':enemy?'#f29c83':'#a2d8c4';c.lineWidth=own?2.5:1.5;
      c.beginPath();c.ellipse(px,py+cell*.15,cell*.34,cell*.2,0,0,Math.PI*2);c.stroke();
      if(a.uid===this.inspectedUid&&!animating){
        c.save();c.strokeStyle='#f9dfa1';c.lineWidth=Math.max(2,cell*.045);
        c.setLineDash([Math.max(3,cell*.12),Math.max(2,cell*.075)]);
        c.beginPath();c.ellipse(px,py+cell*.17,cell*.44*sizeFactor,cell*.27*sizeFactor,0,0,Math.PI*2);
        c.stroke();c.restore();
      }
      const size=cell*1.18*sizeFactor,sw=size*(a.scaleX||1)*pose.sx,sh=size*(a.scaleY||1)*pose.sy;
      const drawn=a.bot?this.sprite('monsters',a.species%5*128,Math.floor(a.species/5)*128,128,128,actorPx-sw/2,actorPy-sh*.7,sw,sh):
        this.sprite(a.gender,0,0,112,112,actorPx-sw/2,actorPy-sh*.76,sw,sh);
      if(!drawn){c.fillStyle=enemy?'#c57a67':'#e5cc8a';c.beginPath();c.arc(actorPx,actorPy-cell*.12,cell*.24,0,Math.PI*2);c.fill();}
      if(a.shield){c.strokeStyle='#9adcf1';c.lineWidth=2;c.beginPath();c.arc(px,py-cell*.12,cell*.39,0,Math.PI*2);c.stroke();}
      if(a.guard){c.strokeStyle='#e3ca89a0';c.lineWidth=1.5;c.beginPath();c.arc(px,py-cell*.12,cell*.44,-Math.PI*.85,-Math.PI*.15);c.stroke();}
      if(a.flash){c.globalAlpha=(a.opacity??1)*a.flash;c.fillStyle='#ffe7c2';c.beginPath();c.ellipse(px,py-cell*.12,cell*.26,cell*.4,0,0,Math.PI*2);c.fill();c.globalAlpha=a.opacity??1;}
      const bar=cell*.76*sizeFactor,barY=py+cell*.34*sizeFactor;
      const health=globalThis.QABattlePresentation.drawHealth(c,a,px-bar/2,barY,bar,4);
      const hpText=health.text,available=cell*.97;
      const fontSize=Math.max(9,Math.min(14,cell*.23));
      c.font='700 '+fontSize+'px system-ui,sans-serif';
      c.textAlign='center';c.textBaseline='top';c.lineJoin='round';c.lineWidth=2.8;
      const hpX=Math.max(available/2,Math.min(w-available/2,px)),hpY=Math.min(h-fontSize-1,barY+5);
      c.strokeStyle='#15241b';c.strokeText(hpText,hpX,hpY,available);
      c.fillStyle='#fff4de';c.fillText(hpText,hpX,hpY,available);
      if(!animating&&s.turnUid===a.uid){c.fillStyle='#f9e6ad';c.beginPath();c.moveTo(px-4,py-cell*.6);c.lineTo(px+4,py-cell*.6);c.lineTo(px,py-cell*.48);c.fill();}
      c.restore();
    }
    for(const a of positions){
      const sword=a.flyingSword;
      const own=a.uid===this.uid;
      if(scene?.style==='flying-sword'&&scene.actor===a.uid){
        const flight=A.flyingSwordPose(scene,progress);
        const color=own?'#d1efe1':'#f6c8a9';
        if(flight)this.drawFlyingSword(flight.position,color,1,flight.angle);
        else if(scene.target)this.drawFlyingSword(scene.target,color,Math.min(1,progress*3));
      }else if(sword)this.drawFlyingSword(sword,own?'#d1efe1':'#f6c8a9');
    }
    if(scene){
      if(s.mode==='pve'&&!this.preview&&!reduced){
        const viewport={ox,oy,cell,width:s.width,height:s.height};
        Impact.drawHitEffects(c,scene,progress,viewport,A);
        Impact.drawPhaseWave(c,scene,progress,viewport);
      }
      this.drawEffect(scene,progress,true);
    }
    if(!frameless){c.strokeStyle='#d9c69380';c.lineWidth=1.5;c.strokeRect(ox+view.x*cell,oy+view.y*cell,cell*view.width,cell*view.height);}
    if(weight)c.restore();
    this.updateFocusAuras(g,positions,now);
    if(!this.preview&&animating){
      // Combat animations keep their original smooth frame timing.
      this.frame=requestAnimationFrame(()=>this.draw());
    }else if(!this.preview&&!reduced&&(objectiveFxActive||ambienceActive||
      myTurn&&this.mode==='move'&&this.range.length)){
      // Lightweight, capped ambient refresh; no perpetual 60fps idle redraw.
      this.ambientTimer=setTimeout(()=>this.draw(),w*h>1350000?100:66);
    }
  }
}
