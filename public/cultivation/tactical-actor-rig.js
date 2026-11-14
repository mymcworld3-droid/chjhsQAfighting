/* Presentation-only articulated poses with generated, matching puppet layers. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QATacticalActorRig=api;
})(globalThis,()=>{
  'use strict';
  const manuals=()=>typeof module==='object'&&module.exports?require('./manual-rules.js'):globalThis.QAManuals;
  const clamp=n=>Math.max(0,Math.min(1,n));
  // Each pose is [left arm, right arm, left leg, right leg, torso].
  const idle=[0,0,0,0,0];
  const poses={
    'wind-slash':[[0,idle],[.22,[.35,.65,-.15,.12,-.10]],[.52,[-.18,-1.55,.25,-.22,.18]],[.8,[.1,-.65,.12,-.1,.08]],[1,idle]],
    'wind-step':[[0,idle],[.20,[.28,-1.30,.45,-.38,.18]],[.43,[-.25,.35,-.3,.35,-.16]],[.68,[.3,-1.60,.4,-.32,.20]],[1,idle]],
    'wind-thousand':[[0,idle],[.23,[.55,.7,-.2,.25,-.18]],[.5,[1.05,-1.7,.35,-.28,.24]],[.82,[.6,-1.15,.22,-.16,.13]],[1,idle]],
    'flight-summon':[[0,idle],[.25,[.35,-1.0,-.12,.12,-.06]],[.58,[1.2,-2.2,.18,-.15,.06]],[.83,[.65,-1.4,.08,-.06,.03]],[1,idle]],
    'sky-cloud':[[0,idle],[.25,[1.35,-.7,.22,-.2,-.16]],[.52,[.2,-2.0,-.2,.28,.16]],[.78,[1.35,-.9,.15,-.12,-.08]],[1,idle]],
    'sky-sever':[[0,idle],[.30,[2.05,-2.05,.3,-.28,-.08]],[.58,[1.25,-1.35,-.28,.32,.22]],[.8,[.8,-.85,-.12,.1,.10]],[1,idle]],
    'rock-fist':[[0,idle],[.20,[.45,.7,-.32,.18,-.17]],[.47,[-.12,-1.55,.32,-.25,.22]],[.78,[.18,-.8,.16,-.1,.1]],[1,idle]],
    'rock-quake':[[0,idle],[.22,[1.35,-2.0,.5,-.45,-.2]],[.5,[.65,-.45,-.35,.45,.3]],[.78,[.32,-.8,-.16,.2,.15]],[1,idle]],
    'rock-break':[[0,idle],[.22,[.6,.9,-.35,.25,-.2]],[.48,[1.3,-1.65,.42,-.32,.26]],[.78,[.7,-1.0,.18,-.12,.12]],[1,idle]],
    'dragon-guard':[[0,[.4,-.4,-.12,.12,0]],[.10,[.32,.35,-.15,.15,-.06]],[.25,[.15,-1.58,.34,-.3,.2]],[.65,[.35,-1.0,.18,-.15,.1]],[1,[.4,-.4,-.12,.12,0]]],
    'dragon-roar':[[0,idle],[.25,[1.15,-1.15,-.3,.3,-.08]],[.58,[1.85,-1.85,-.45,.45,-.04]],[.82,[1.15,-1.15,-.24,.24,.06]],[1,idle]],
    'tiger-step':[[0,idle],[.20,[.25,-1.55,.38,-.34,.19]],[.45,[1.5,.25,-.35,.38,-.17]],[.7,[.15,-1.45,.32,-.3,.17]],[1,idle]],
    'tiger-throw':[[0,idle],[.24,[1.35,-1.4,.26,-.25,.2]],[.52,[.35,-.25,-.3,.35,-.22]],[.8,[-.55,.75,.25,-.2,-.24]],[1,idle]],
    attack:[[0,idle],[.25,[.28,.55,-.15,.12,-.08]],[.55,[.1,-1.3,.22,-.2,.16]],[1,idle]]
  };
  const swords=new Set(['wind-slash','wind-step','wind-thousand','sky-cloud','sky-sever']);
  // Transparent, painted puppet layers share one atlas; each core includes
  // the intact hair and robe, avoiding holes from cutting a flattened sprite.
  const coreRects={
    male:[[85,20,300,420],[480,20,300,420],[880,20,300,420]],
    female:[[80,462,310,420],[480,462,300,420],[880,462,300,420]]
  };
  const armRects=[[153,955,125,206],[580,955,115,207]];
  const legRect=[985,964,92,206];
  function moveFor(scene){
    const id=scene?.skill||scene?.visualSkill;
    return manuals()?.BY_SKILL?.[id]?.moveId||id;
  }
  function poseFor(scene,progress){
    const move=moveFor(scene),frames=poses[move];if(!frames)return null;
    const p=clamp(progress);let index=0;
    while(index<frames.length-2&&p>frames[index+1][0])index++;
    const [t0,a]=frames[index],[t1,b]=frames[index+1],u=clamp((p-t0)/(t1-t0)),q=u*u*(3-2*u);
    let values=a.map((x,i)=>x+(b[i]-x)*q);
    if(move==='dragon-guard'&&scene.step%2===0)values=[-values[1],-values[0],-values[3],-values[2],-values[4]];
    if(scene.kind==='move'){
      const run=Math.sin(p*Math.PI*2);
      values=[values[0]*.7+run*.25,values[1]*.7-run*.25,run*.42,-run*.42,values[4]*.6];
    }
    return {move,leftArm:values[0],rightArm:values[1],leftLeg:values[2],rightLeg:values[3],torso:values[4],weapon:swords.has(move)};
  }
  function facing(scene,actor){
    const path=scene.moves?.find(m=>m.uid===actor.uid)?.path;
    const owner=scene.before?.find(a=>a.uid===actor.uid)||actor;
    const origin=scene.kind==='move'&&path?.length?path[0]:moveFor(scene)==='flight-summon'?owner:scene.origin||owner;
    const target=scene.kind==='move'&&path?.length?path.at(-1):scene.target||origin;
    const dx=target.x-origin.x,dy=target.y-origin.y;
    if(!dx&&!dy)return 0;
    return Math.abs(dx)>=Math.abs(dy)?dx>0?1:2:dy>0?0:3;
  }
  function draw(c,image,actor,scene,progress,box,rigImage){
    if(actor.bot||!rigImage?.complete||!(rigImage.naturalWidth>=1254&&rigImage.naturalHeight>=1254))return false;
    const active=scene?.actor===actor.uid&&['cast','move'].includes(scene.kind);
    let pose=active?poseFor(scene,progress):null;
    if(!pose){
      const stride=active&&scene.kind==='move'?Math.sin(clamp(progress)*Math.PI*4)*.35:0;
      pose={leftArm:stride,rightArm:-stride,leftLeg:-stride,rightLeg:stride,torso:0,weapon:false};
    }
    const row=active?facing(scene,actor):(actor.row??0),direction=row===1||row===2?1:row===3?2:0;
    const gender=actor.gender==='female'?'female':'male';
    const shoulders=direction===1?[[57,54],[65,54]]:gender==='female'?[[49,52],[69,52]]:[[46,54],[67,54]];
    const leg=(x,angle)=>{
      c.save();c.translate(x,87);c.rotate(angle);
      c.drawImage(rigImage,...legRect,-3.5,-2,7,17);c.restore();
    };
    const arm=(index,angle,bend,weapon=false)=>{
      const rect=armRects[index],x=index===0?-8:-5;
      c.save();c.translate(...shoulders[index]);c.rotate(angle);
      // The sleeve is one painted piece. The overlapping elbow crop bends
      // without a second cuff or a detached shoulder cap.
      c.save();c.translate(0,8);c.rotate(bend);
      if(weapon)drawSword(c,progress);
      c.drawImage(rigImage,rect[0],rect[1]+74,rect[2],rect[3]-74,x,-1,14,16.5);
      c.restore();
      c.drawImage(rigImage,rect[0],rect[1],rect[2],96,x,-2,14,12);
      c.restore();
    };
    c.save();c.translate(box.x,box.y);c.scale(box.width/112,box.height/112);
    if(row===2){c.translate(112,0);c.scale(-1,1);}
    leg(52,pose.leftLeg);leg(64,pose.rightLeg);
    c.save();c.translate(56,72);c.rotate(pose.torso);c.translate(-56,-72);
    if(direction!==0)arm(0,pose.leftArm,-pose.leftArm*.25);
    if(direction===2)arm(1,pose.rightArm,-pose.rightArm*.25,pose.weapon);
    c.drawImage(rigImage,...coreRects[gender][direction],25,5,gender==='female'&&direction===0?62:60,84);
    if(direction===0)arm(0,pose.leftArm,-pose.leftArm*.25);
    if(direction!==2)arm(1,pose.rightArm,-pose.rightArm*.25,pose.weapon);
    c.restore();c.restore();return true;
  }
  function drawSword(c,progress){
    c.save();c.globalAlpha*=Math.sin(Math.PI*clamp(progress));c.strokeStyle='#b7e8da';c.lineWidth=3;c.lineCap='round';c.shadowColor='#a3e8d9';c.shadowBlur=4;
    c.beginPath();c.moveTo(0,13);c.lineTo(2,40);c.stroke();c.strokeStyle='#f1fff9';c.lineWidth=1;c.beginPath();c.moveTo(0,13);c.lineTo(2,40);c.stroke();
    c.strokeStyle='#caa66d';c.lineWidth=2.4;c.beginPath();c.moveTo(-4,14);c.lineTo(4,14);c.stroke();c.restore();
  }
  return Object.freeze({poseFor,facing,draw});
});
