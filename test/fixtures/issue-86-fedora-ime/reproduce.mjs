import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {captureTerminalBuffer,normalizeFixture} from '/home/krisspy/.codex/worktrees/e37a/obsidian-opencode/scripts/capture-terminal-fixture.mjs';
const out='/home/krisspy/.codex/worktrees/e37a/obsidian-opencode/test-results/issue86';
mkdirSync(out,{recursive:true});
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8'}).trim();
function evaluate(js){return JSON.parse(execFileSync('agent-browser',['--session','issue86','eval','--stdin'],{input:js,encoding:'utf8'}));}
function keys(...codes){run('/home/krisspy/.cache/issue86-repro/keys',codes.map(String));}
const cases=[{name:'chinese',ime:'pinyin',keys:[49,23,35,30,24],once:'nihao',duplicate:'ni haonihao'},{name:'japanese',ime:'mozc',keys:[37,24,49,49,49,23,46,35,23,17,30],once:'こんにちわ',duplicate:'こんにちわこんにちわ'}];
const results=[];
for(const c of cases){for(let attempt=1;attempt<=2;attempt++){
run('kdotool',['search','--title','vault - Obsidian','windowactivate']);
evaluate("app.workspace.getLeavesOfType('opencode-terminal')[0].view.terminal.focus();true");
run('fcitx5-remote',['-s','keyboard-us']);await delay(200);keys(29,22,-22,-29);await delay(200);
evaluate('issue86.events=[];issue86.data=[];issue86.started=Date.now();true');
run('fcitx5-remote',['-s',c.ime]);await delay(200);
keys(...c.keys.flatMap(k=>[k,-k]));
const preedit=evaluate("({events:issue86.events,value:app.workspace.getLeavesOfType('opencode-terminal')[0].view.terminal.textarea.value})");
if(!preedit.events.some(x=>x.type==='compositionupdate'&&x.isTrusted))throw Error('Native composition missing');
keys(125,57,-57,-125);await delay(250);
const trace=evaluate('issue86');
const buffer=evaluate(`(${captureTerminalBuffer.toString()})(app.workspace.getLeavesOfType('opencode-terminal')[0].view.terminal)`);
const input=trace.data.map(x=>x.data).filter(x=>!x.startsWith('\x1b')).join('');
const bufferMatch=buffer.lines.some(x=>x.text.includes(c.duplicate));
const reproduced=input===c.duplicate&&bufferMatch;
const stem=`${c.name}-${attempt}`;
writeFileSync(`${out}/${stem}-events.json`,JSON.stringify({preedit,...trace,input,expected:c.once,actual:c.duplicate,reproduced},null,2)+'\n');
writeFileSync(`${out}/${stem}-buffer.json`,normalizeFixture(buffer));
run('agent-browser',['--session','issue86','screenshot',`${out}/${stem}.png`]);
const result={case:c.name,attempt,preedit:preedit.value,input,expected:c.once,bufferMatch,reproduced};results.push(result);console.log(JSON.stringify(result));
}}
writeFileSync(out+'/results.json',JSON.stringify(results,null,2)+'\n');
if(!results.every(x=>x.reproduced))process.exitCode=2;
