'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const replacements={'/* SIMULATOR_CSS */':'public/world/world-simulator.css','/* WORLD_CORE */':'public/world/world-core.js','/* WORLD_WORKER */':'public/world/world-simulator-worker.js','/* SIMULATOR_JS */':'public/world/world-simulator.js'};
let html=read('scripts/world-simulator.template.html');for(const[tag,name]of Object.entries(replacements))html=html.replace(tag,()=>read(name).replace(/<\/script/gi,'<\\/script'));
const target=path.join(root,'public/world-simulator.html');if(process.argv.includes('--check')){if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==html){console.error('種子模擬器需要重新建置');process.exitCode=1;}}else{fs.writeFileSync(target,html);console.log('Built public/world-simulator.html (standalone, no network required)');}
