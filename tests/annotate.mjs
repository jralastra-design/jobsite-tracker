// Turns failed rules tests into GitHub annotations so they show up on the run page.
import { readFileSync } from 'node:fs';
const t = readFileSync(process.argv[2], 'utf8').split('\n');
let fails = 0;
for (let i = 0; i < t.length; i++) {
  const m = t[i].match(/^\s*not ok \d+ - (.*)$/);
  if (!m) continue;
  fails++;
  const detail = t.slice(i + 1, i + 25).filter(l => /error|message|expected|actual|code|PERMISSION|FirebaseError|Null value|Property/i.test(l)).map(l => l.trim()).slice(0, 6).join(' | ');
  console.log(`::error title=Rules test failed: ${m[1].replace(/[\r\n:]/g, ' ')}::${detail.replace(/[\r\n]/g, ' ').slice(0, 900)}`);
}
if (!fails && !/^# pass/m.test(t.join('\n'))) console.log('::error title=Rules tests did not run::' + t.slice(-30).join(' ').replace(/[\r\n]/g, ' ').slice(-900));
const pass = (t.join('\n').match(/^# pass (\d+)/m) || [])[1], fail = (t.join('\n').match(/^# fail (\d+)/m) || [])[1];
console.log(`::notice title=Rules tests::${pass ?? '?'} passed, ${fail ?? '?'} failed`);
