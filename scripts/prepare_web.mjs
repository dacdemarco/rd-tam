import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const pub=path.join(root,'public');
await fs.mkdir(pub,{recursive:true});
for(const entry of ['assets','vendor']){
  await fs.cp(path.join(root,'web',entry),path.join(pub,entry),{recursive:true});
}
for(const name of ['analysis.js','config.json']) await fs.copyFile(path.join(root,'web',name),path.join(pub,name));
const onnx=path.join(root,'node_modules/onnxruntime-web/dist');
await fs.mkdir(path.join(pub,'vendor/onnx'),{recursive:true});
for(const file of await fs.readdir(onnx)) if(/\.(wasm|mjs)$/.test(file)) await fs.copyFile(path.join(onnx,file),path.join(pub,'vendor/onnx',file));
await fs.mkdir(path.join(pub,'vendor/ffmpeg'),{recursive:true});
for(const file of ['ffmpeg-core.js','ffmpeg-core.wasm']) await fs.copyFile(path.join(root,'node_modules/@ffmpeg/core/dist/esm',file),path.join(pub,'vendor/ffmpeg',file));
await import('./collect_web_licenses.mjs');
console.log('Recursos web preparados.');
