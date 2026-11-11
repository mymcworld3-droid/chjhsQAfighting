// The page is a scaled iframe inside a fixed-aspect game stage. Mobile keyboards
// move the *visual* viewport, not the logical game board. Freeze the board and
// dock the active typing overlay to the actual visible part of the parent viewport.
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;

export function projectKeyboardViewport(viewport,stage,design){
  if(!viewport||!stage||!Number(stage.scale))return null;
  const scale=Math.max(.01,finite(stage.scale,1));
  const designWidth=Math.max(1,finite(stage.designWidth,design.width));
  const designHeight=Math.max(1,finite(stage.designHeight,design.height));
  const left=clamp((finite(viewport.offsetLeft,0)-finite(stage.left,0))/scale,0,designWidth);
  const top=clamp((finite(viewport.offsetTop,0)-finite(stage.top,0))/scale,0,designHeight);
  const right=clamp((finite(viewport.offsetLeft,0)+finite(viewport.width,0)-finite(stage.left,0))/scale,0,designWidth);
  const bottom=clamp((finite(viewport.offsetTop,0)+finite(viewport.height,0)-finite(stage.top,0))/scale,0,designHeight);
  return {left,top,width:Math.max(0,right-left),height:Math.max(0,bottom-top),
    keyboardVisible:bottom-top<designHeight-75};
}

export function installTacticalKeyboardGuard(root){
  let locked=false,raf=0,release=0,lastSignal=null;
  let parent=null,outerViewport=null;
  try{
    if(window.parent!==window&&window.frameElement?.id==='game-frame'){
      parent=window.parent;
      outerViewport=parent.visualViewport||null;
    }
  }catch(_){parent=null;outerViewport=null;}

  const report=active=>{
    if(lastSignal===active)return;
    lastSignal=active;
    try{parent?.postMessage({type:'qa:game-typing',active},window.location.origin);}catch(_){}
  };
  const isTypingControl=node=>!!node?.matches?.('input:not([type=hidden]),textarea,[contenteditable=true]');
  const readDesign=()=>{
    let stage=null;
    try{stage=parent?.QAGameStage?.getState?.()||null;}catch(_){}
    const rect=root.getBoundingClientRect();
    return {stage,width:finite(stage?.designWidth,rect.width),height:finite(stage?.designHeight,rect.height)};
  };
  const update=()=>{
    raf=0;
    if(!locked||!root.isConnected)return;
    const control=document.activeElement;
    const overlay=isTypingControl(control)?control.closest?.('[data-question-tool]:not([hidden])'):null;
    if(!overlay||!root.contains(overlay)){
      root.classList.remove('tc-keyboard-visible');
      return;
    }
    const design=readDesign();
    let bounds=projectKeyboardViewport(outerViewport,design.stage,design);
    if(!bounds){
      const local=window.visualViewport;
      bounds=local?{left:clamp(finite(local.offsetLeft,0),0,design.width),
        top:clamp(finite(local.offsetTop,0),0,design.height),
        width:clamp(finite(local.width,design.width),0,design.width),
        height:clamp(finite(local.height,design.height),0,design.height),
        keyboardVisible:finite(local.height,design.height)<design.height-75}:null;
    }
    if(!bounds||!bounds.keyboardVisible||bounds.width<100||bounds.height<110){
      root.classList.remove('tc-keyboard-visible');
      return;
    }
    root.style.setProperty('--tc-visible-top',bounds.top.toFixed(1)+'px');
    root.style.setProperty('--tc-visible-left',bounds.left.toFixed(1)+'px');
    root.style.setProperty('--tc-visible-width',bounds.width.toFixed(1)+'px');
    root.style.setProperty('--tc-visible-height',bounds.height.toFixed(1)+'px');
    root.classList.add('tc-keyboard-visible');
  };
  const schedule=()=>{
    if(raf)return;
    raf=requestAnimationFrame(update);
  };
  const lock=()=>{
    clearTimeout(release);
    if(!locked){
      const {width,height}=readDesign();
      root.style.setProperty('--tc-locked-width',Math.max(1,width)+'px');
      root.style.setProperty('--tc-locked-height',Math.max(1,height)+'px');
      root.classList.add('tc-typing-locked');
      locked=true;
    }
    report(true);
    schedule();
  };
  const unlock=()=>{
    if(!locked)return;
    locked=false;
    root.classList.remove('tc-typing-locked','tc-keyboard-visible');
    for(const name of ['--tc-locked-width','--tc-locked-height','--tc-visible-left',
      '--tc-visible-top','--tc-visible-width','--tc-visible-height'])root.style.removeProperty(name);
    report(false);
  };
  const onPointer=event=>{
    if(isTypingControl(event.target)&&root.contains(event.target))lock();
  };
  const onFocus=event=>{
    if(isTypingControl(event.target)&&root.contains(event.target))lock();
  };
  const onBlur=()=>{
    clearTimeout(release);
    // iOS animates the keyboard closing. Avoid refitting the iframe while its
    // animation is still moving; a subsequent focus cancels this timer.
    release=setTimeout(()=>{
      if(isTypingControl(document.activeElement)&&root.contains(document.activeElement))return;
      unlock();
    },350);
  };
  root.addEventListener('pointerdown',onPointer,true);
  root.addEventListener('focusin',onFocus,true);
  root.addEventListener('focusout',onBlur,true);
  outerViewport?.addEventListener('resize',schedule,{passive:true});
  outerViewport?.addEventListener('scroll',schedule,{passive:true});
  window.visualViewport?.addEventListener('resize',schedule,{passive:true});
  window.visualViewport?.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  return {schedule,dispose(){
    clearTimeout(release);
    if(raf)cancelAnimationFrame(raf);
    unlock();
    root.removeEventListener('pointerdown',onPointer,true);
    root.removeEventListener('focusin',onFocus,true);
    root.removeEventListener('focusout',onBlur,true);
    outerViewport?.removeEventListener('resize',schedule);
    outerViewport?.removeEventListener('scroll',schedule);
    window.visualViewport?.removeEventListener('resize',schedule);
    window.visualViewport?.removeEventListener('scroll',schedule);
    window.removeEventListener('resize',schedule);
  }};
}
