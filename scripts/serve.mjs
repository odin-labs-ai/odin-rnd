import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript; charset=utf-8','.md':'text/plain; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.txt':'text/plain','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm'};
const server = http.createServer(async (req,res) => {
  try {
    let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // Mirror the GitHub Pages project prefix during local verification.
    if (name.startsWith('/odin-rnd/')) name=name.slice('/odin-rnd'.length);
    if(name.endsWith('/')) name+='index.html';
    const file=resolve(root,'.'+name);
    if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    const body=await readFile(file);
    const type = types[extname(file)] || 'application/octet-stream';
    const headers = {'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store'};
    if (type.startsWith('video/')) {
      headers['Accept-Ranges'] = 'bytes';
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        if (start > end || start >= body.length) {
          res.writeHead(416, {'Content-Range': 'bytes */' + body.length});
          res.end();
          return;
        }
        res.writeHead(206, {...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${body.length}`});
        res.end(body.subarray(start, end + 1));
        return;
      }
    }
    res.writeHead(200, headers);
    res.end(body);
  } catch {res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('Odin R&D: http://127.0.0.1:'+server.address().port+'/odin-rnd/'));
