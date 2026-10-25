import './tactical-rules.js';
import './tactical-animation.js';
import './tactical-demo-rules.js';
import {TacticalRenderer} from './tactical-renderer.js';

// An isolated, read-only arena. This controller never calls the battle API.
export class EnemyDemo{
  constructor(host,species){
    this.host=host;this.demo=globalThis.QATacticalDemo.build(species);this.canvas=host.querySelector('canvas');this.caption=host.querySelector('[data-demo-caption]');
    this.canvas.dataset.demoSpecies=String(this.demo.species);
    this.renderer=new TacticalRenderer(this.canvas,()=>{});this.media=window.matchMedia('(prefers-reduced-motion:reduce)');
    this.elapsed=0;this.started=performance.now();this.paused=false;this.frame=0;this.destroyed=false;this.index=-1;
    this.toggle=host.querySelector('[data-demo-toggle]');this.next=host.querySelector('[data-demo-next]');
    this.modeLabel=host.querySelector('[data-demo-mode]');
    this.toggle.onclick=()=>{this.freeze();this.paused=!this.paused;this.started=performance.now();this.refresh();};
    host.querySelector('[data-demo-replay]').onclick=()=>{this.elapsed=0;this.started=performance.now();this.index=-1;this.paused=false;this.refresh();};
    this.next.onclick=()=>{const beat=this.demo.beats[(this.index+1)%this.demo.beats.length];this.elapsed=beat.start;this.started=performance.now();this.refresh();};
    this.preference=()=>{this.freeze();this.started=performance.now();this.refresh();};
    this.visibility=()=>{if(document.hidden)this.freeze();else this.started=performance.now();this.refresh();};
    this.media.addEventListener('change',this.preference);document.addEventListener('visibilitychange',this.visibility);this.refresh();
  }
  freeze(){if(this.running)this.elapsed+=performance.now()-this.started;this.running=false;this.started=performance.now();}
  refresh(){
    cancelAnimationFrame(this.frame);this.frame=0;if(this.destroyed)return;
    const manual=this.media.matches,controls=manual+':'+this.paused;
    if(this.controls!==controls){
      this.controls=controls;this.toggle.hidden=manual;this.next.hidden=!manual;
      this.toggle.textContent=this.paused?'播放':'暫停';this.toggle.setAttribute('aria-pressed',String(this.paused));this.modeLabel.textContent=manual?'逐步示範':'自動循環';
    }
    this.running=!this.paused&&!manual&&!document.hidden;if(document.hidden)return;
    const elapsed=this.elapsed+(!this.paused&&!manual?performance.now()-this.started:0),local=elapsed%this.demo.duration;
    const index=this.demo.beats.findIndex(b=>local<b.start+b.duration),beat=this.demo.beats[index];
    const progress=manual?.6:Math.max(0,Math.min(1,(local-beat.start)/beat.duration));
    const changed=this.index!==index;
    if(changed){this.caption.textContent=beat.label;this.index=index;this.canvas.dataset.demoPhase=beat.phase;this.canvas.dataset.demoStep=String(index);}
    if(changed||beat.scene)this.renderer.present(beat.state,this.demo.hero,beat.scene,progress,this.demo.view);
    if(!manual&&!this.paused)this.frame=requestAnimationFrame(()=>this.refresh());
  }
  destroy(){
    this.destroyed=true;cancelAnimationFrame(this.frame);this.renderer.destroy();this.media.removeEventListener('change',this.preference);document.removeEventListener('visibilitychange',this.visibility);
  }
}
