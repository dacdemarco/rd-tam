import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const pub=path.join(root,'public');
await fs.mkdir(pub,{recursive:true});
for(const entry of ['assets','vendor']){
  await fs.cp(path.join(root,'web',entry),path.join(pub,entry),{recursive:true});
}
for(const name of ['analysis.js','config.json']) await fs.copyFile(path.join(root,'web',name),path.join(pub,name));
await import('./collect_web_licenses.mjs');
console.log('Recursos web preparados.');
