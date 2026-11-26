import fs from 'node:fs/promises';
import path from 'node:path';
import { renameRetry } from '../src/fs-retry.mjs';
const uuid=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;


function folder(dir,id){
  if(typeof id!=='string'||!uuid.test(id))throw Error('资料编号无效');
  return path.join(dir,id);
}

export async function saveEntry(dir,meta,text){
  await fs.mkdir(dir,{recursive:true});
  const staging=await fs.mkdtemp(path.join(dir,'.upload-'));
  try {
    await fs.writeFile(path.join(staging,'text.md'),text);
    await fs.writeFile(path.join(staging,'meta.json'),JSON.stringify(meta,null,2));
    await renameRetry(staging,folder(dir,meta.id));
  } finally {await fs.rm(staging,{recursive:true,force:true});}
  return meta;
}
const metadata=async(dir,id)=>JSON.parse(await fs.readFile(path.join(folder(dir,id),'meta.json'),'utf8'));
export async function listEntries(dir){
  const entries=await fs.readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  return Promise.all(entries.filter(e=>e.isDirectory()&&uuid.test(e.name)).map(e=>metadata(dir,e.name)));
}
export async function readEntry(dir,id){
  const meta=await metadata(dir,id);
  const text=await fs.readFile(path.join(folder(dir,id),'text.md'),'utf8');
  return {...meta,text};
}
export const deleteEntry=(dir,id)=>fs.rm(folder(dir,id),{recursive:true});
