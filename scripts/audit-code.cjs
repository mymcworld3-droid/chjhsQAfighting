'use strict';

// Parse every project source and JSON file, then link browser ES modules without
// evaluating them or contacting Firebase / D1 / AI services.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync,spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))];
const sources=files.filter(file=>/\.(?:cjs|mjs|js)$/.test(file));
const json=files.filter(file=>file.endsWith('.json'));
const failures=[];

function syntax(file){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  const kind=file.endsWith('.mjs')||/^\s*(?:import\s|export\s)/m.test(source)?'module':'commonjs';
  return new Promise(resolve=>{
    const child=spawn(process.execPath,['--input-type='+kind,'--check'],{stdio:['pipe','ignore','pipe']});
    let error='';child.stderr.on('data',data=>{error+=data;});
    child.on('error',cause=>{failures.push({file,check:'syntax',error:cause.message});resolve();});
    child.on('close',code=>{if(code)failures.push({file,check:'syntax',error:error.trim()});resolve();});
    child.stdin.on('error',()=>{});child.stdin.end(source);
  });
}

async function main(){
  let index=0;
  await Promise.all(Array.from({length:6},async()=>{while(index<sources.length)await syntax(sources[index++]);}));
  for(const file of json)try{JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));}
    catch(error){failures.push({file,check:'json',error:error.message});}

  const browser=sources.filter(file=>file.startsWith('public/')&&file.endsWith('.js'));
  const modules=new Map(),externals=new Map(),names=new Set(['default']);
  // External SDKs are stubs: validate local export bindings, not vendor exports.
  for(const file of browser){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const match of source.matchAll(/import\s*\{([^}]+)\}\s*from/g))for(const item of match[1].split(',')){
      const name=item.trim().split(/\s+as\s+/)[0];if(/^\w+$/.test(name))names.add(name);
    }
    for(const match of source.matchAll(/\bimport\(\s*(['"])([^'"]+)\1\s*\)/g)){
      const specifier=match[2];
      if(specifier.startsWith('.')&&!fs.existsSync(path.resolve(root,path.dirname(file),specifier.split(/[?#]/)[0])))
        failures.push({file,check:'dynamic-import',error:'Missing '+specifier});
    }
  }
  function get(file){
    if(!modules.has(file))modules.set(file,new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{identifier:file}));
    return modules.get(file);
  }
  async function link(specifier,parent){
    if(/^https?:/.test(specifier)){
      if(!externals.has(specifier))externals.set(specifier,new vm.SyntheticModule([...names],function(){},{identifier:specifier}));
      return externals.get(specifier);
    }
    const file=path.resolve(path.dirname(parent.identifier),specifier.split(/[?#]/)[0]);
    if(!file.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(file))throw Error('Missing local module '+specifier);
    return get(file);
  }
  for(const file of browser)try{
    if(typeof vm.SourceTextModule!=='function')throw Error('Run with --experimental-vm-modules');
    const module=get(path.join(root,file));if(module.status==='unlinked')await module.link(link);
  }catch(error){failures.push({file,check:'module-link',error:error.message});}
  const report={sourceFiles:sources.length,jsonFiles:json.length,browserModules:browser.length,failures};
  if(process.argv.includes('--json'))console.log(JSON.stringify({...report,files:[...sources,...json].sort()},null,2));
  else{
    console.log(`Syntax: ${sources.length} sources; JSON: ${json.length}; browser module links: ${browser.length}.`);
    for(const failure of failures)console.error(`${failure.file} (${failure.check}): ${failure.error}`);
    console.log(failures.length?`${failures.length} failures.`:'All checks passed.');
  }
  if(failures.length)process.exitCode=1;
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
