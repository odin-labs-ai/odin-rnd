"""Run the pinned local model on the already frozen new fixture; retain every response."""
import datetime
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import unicodedata
import uuid

os.umask(0o077)
ROOT=Path(__file__).resolve().parent
ASSETS=Path(os.environ['VOYAGE_FIXTURE_ASSETS']).resolve()


def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()


def canonical(value):
    return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()


def main():
    protocol=json.loads((ROOT/'protocol.json').read_text())
    fixture=json.loads((ROOT/'fixture.json').read_text())
    assert hashlib.sha256(canonical(fixture)).hexdigest()==protocol['fixtureSha256']
    assert len(fixture['inputs'])==protocol['counts']['embeddingInputs']==64
    model=ASSETS/'voyage-4-nano-Q8_0.gguf'
    binary=ASSETS/'llama/llama-b11865/llama-server'
    assert sha(model)==protocol['model']['sha256']
    run=ROOT/('inference-'+uuid.uuid4().hex[:10]);run.mkdir(mode=0o700)
    sockdir=Path(tempfile.mkdtemp(prefix='ctxv-'));sockpath=sockdir/'e.sock'
    secret=secrets.token_urlsafe(32)

    class UnixHTTP(http.client.HTTPConnection):
        def connect(self):
            self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
            self.sock.settimeout(self.timeout);self.sock.connect(str(sockpath))

    def request(path,payload=None,auth=True):
        conn=UnixHTTP('localhost',timeout=120)
        headers={'Content-Type':'application/json'}
        if auth:headers['Authorization']='Bearer '+secret
        conn.request('POST' if payload is not None else 'GET',path,body=json.dumps(payload) if payload is not None else None,headers=headers)
        resp=conn.getresponse();body=resp.read();conn.close()
        return resp.status,json.loads(body)

    result=dict(schema='context-embeddings/1',run=run.name,startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),command='python3 embed_fixture.py',protocolSha256=sha(ROOT/'protocol.json'),fixtureSha256=protocol['fixtureSha256'],sources={p.name:sha(p) for p in [ROOT/'embed_fixture.py',ROOT/'prepare.py']},modelSha256=sha(model),binarySha256=sha(binary),rawResponses=[],embeddings={},status='running')
    logpath=run/'model-server.log'
    process=None
    try:
        with logpath.open('w') as log:
            process=subprocess.Popen([str(binary),'-m',str(model),'--embedding','--host',str(sockpath),'-c','1024','-b','1024','-ub','1024','-np','1','-t','4','-ngl','0','--no-webui'],env=dict(os.environ,LLAMA_API_KEY=secret),stdout=log,stderr=subprocess.STDOUT)
            for _ in range(90):
                if process.poll() is not None:raise RuntimeError('Embedding server exited during startup')
                try:
                    if request('/health')[0]==200:break
                except (OSError,ValueError):pass
                time.sleep(1)
            else:raise RuntimeError('Embedding server startup timeout')
            sockpath.chmod(0o600)
            assert request('/v1/embeddings',{'input':['negative control']},auth=False)[0]==401
            result['unauthenticatedRequestRejected']=True
            for offset in range(0,len(fixture['inputs']),4):
                inputs=fixture['inputs'][offset:offset+4]
                texts=[unicodedata.normalize('NFC',protocol['embeddings'][i['role']+'Prefix']+i['text']) for i in inputs]
                status,response=request('/v1/embeddings',{'input':texts})
                assert status==200
                records=sorted(response['data'],key=lambda r:r['index']);assert len(records)==len(inputs)
                for item,record in zip(inputs,records):
                    vec=record['embedding'];assert len(vec)==2048 and all(math.isfinite(x) for x in vec)
                    v=vec[:512];norm=math.sqrt(math.fsum(x*x for x in v));assert norm>0
                    result['embeddings'][item['id']]=[x/norm for x in v]
                if 'model' in response:
                    response['model']=protocol['model']['id']
                result['rawResponses'].append(dict(offset=offset,ids=[i['id'] for i in inputs],response=response))
                print(json.dumps({'embedded':offset+len(inputs),'total':64}),flush=True)
            result.update(status='passed',exportTransformation='Response model field normalized to official model ID; numerical coordinates and usage unchanged.')
    except Exception as exc:
        result.update(status='failed',error=str(exc))
    finally:
        if process is not None:
            process.terminate()
            try:process.wait(timeout=15)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=10)
        if logpath.exists():logpath.write_text(logpath.read_text().replace(secret,'[REDACTED]'))
        if sockpath.exists():sockpath.unlink()
        sockdir.rmdir()
        result.update(endedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),processStopped=process is None or process.poll() is not None)
        (run/'embeddings.json').write_text(json.dumps(result,indent=2)+'\n')
        (ROOT/'latest-inference.json').write_text(json.dumps(dict(path=run.name,status=result['status']),indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ['status','run','processStopped']}),flush=True)
    assert result['status']=='passed'


if __name__=='__main__':main()
