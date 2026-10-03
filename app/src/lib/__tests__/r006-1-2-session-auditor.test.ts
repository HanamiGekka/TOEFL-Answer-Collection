import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import golden from './fixtures/v1.0.0-dynamic-v6.json';
import { prepareRecoverySession } from '../recovery';
import { buildSessionExportBundle } from '../sessionExport';
import { buildSessionRecordIndex } from '../exporters';

const roots: string[]=[];
const script=resolve(process.cwd(),'scripts/audit-session-export.mjs');
afterEach(()=>{for(const root of roots.splice(0)) rmSync(root,{recursive:true,force:true});});
function fixture() {
  const prepared=prepareRecoverySession(golden);
  if(!prepared.ok) throw new Error(prepared.diagnostic);
  const bundle=buildSessionExportBundle(prepared.session,[]);
  const root=mkdtempSync(resolve(tmpdir(),'r009-synthetic-export-audit-'));
  roots.push(root);
  const directory=resolve(root,bundle.directory);
  mkdirSync(directory,{recursive:true});
  for(const [name,content] of Object.entries(bundle.files)) writeFileSync(resolve(directory,name),content);
  writeFileSync(resolve(directory,'record-index.json'),JSON.stringify(buildSessionRecordIndex(prepared.session,bundle.directory,Object.keys(bundle.files))));
  return directory;
}
describe('Read-only v6 export auditor',()=>{
  it('accepts the official-format synthetic v6 export',()=>{
    const result=spawnSync(process.execPath,[script,fixture()],{encoding:'utf8'});
    expect(result.status,result.stdout+result.stderr).toBe(0);
    expect(result.stdout).toContain('PASS');
  });
  it('rejects duplicate event sequences without modifying the export',()=>{
    const directory=fixture();
    const path=resolve(directory,'events.jsonl');
    const event={session_id:golden.session_id,seq:1,monotonic_elapsed_ms:100,wall_clock:golden.created_at,event_type:'synthetic',payload:{},schema_version:'1.0.0'};
    const text=JSON.stringify(event)+'\n'+JSON.stringify(event)+'\n';
    writeFileSync(path,text);
    const result=spawnSync(process.execPath,[script,directory],{encoding:'utf8'});
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('EVENT_SEQUENCE');
    expect(readFileSync(path,'utf8')).toBe(text);
  });
});
