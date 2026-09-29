import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = resolve(process.argv[2] ?? 'src-tauri/target/release/toefl-answer-collection.exe');
const pe = readFileSync(path);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(pe.length >= 0x40 && pe.toString('ascii', 0, 2) === 'MZ', 'Missing DOS header');
const header = pe.readUInt32LE(0x3c);
assert(header + 24 + 70 <= pe.length, 'Truncated PE header');
assert(pe.toString('ascii', header, header + 4) === 'PE\0\0', 'Missing PE signature');
assert(pe.readUInt16LE(header + 4) === 0x8664, 'Expected x86_64 architecture');
const optional = header + 24;
assert(pe.readUInt16LE(optional) === 0x20b, 'Expected PE32+ executable');
const subsystem = pe.readUInt16LE(optional + 68);
assert(subsystem === 2, `Expected Windows GUI subsystem (2), found ${subsystem}`);
console.log(`WINDOWS RELEASE PE PASS: x86_64, GUI subsystem (${path})`);
