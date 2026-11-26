import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import JSZip from 'jszip';

export async function checkTemplateImport(root, output) {
  const dir = path.join(output,'import');
  await fs.mkdir(dir);
  for (const entry of ['server.mjs','app','tools','src','themes','presets']) {
    await fs.cp(path.join(root,entry),path.join(dir,entry),{recursive:true});
  }
  await fs.symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'),'junction');
  await fs.mkdir(path.join(dir,'examples'));
  await fs.mkdir(path.join(dir,'packs/pptx-legacy'),{recursive:true});
  await fs.writeFile(path.join(dir,'examples/pptx-legacy.deck.json'),'legacy');
  const zip = new JSZip();
  zip.file('ppt/presentation.xml','<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>');
  zip.file('ppt/slides/slide1.xml','<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sld>');
  const base64 = await zip.generateAsync({type:'base64'});
  const server = spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,PORT:'0'},windowsHide:true});
  try {
    const [message] = await once(server.stdout,'data');
    const origin = message.toString().trim().match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const response = await fetch(origin+'/api/import-pptx',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:'fixture.pptx',base64})});
    const info = await response.json();
    assert.ok(response.ok,JSON.stringify(info));
    assert.deepEqual(await fs.readdir(path.join(dir,'examples')),['pptx-legacy.deck.json']);
    assert.deepEqual(await (await fetch(origin+'/api/decks')).json(),[]);
    const packs = await (await fetch(origin+'/api/packs')).json();
    assert.deepEqual(packs.map(p=>[p.id,p.kind,p.layouts.length]),[[info.packId,'user-template',1]]);
    return 3;
  } finally {
    const closed=once(server,'close');
    server.kill();
    await closed;
  }
}
