import test from 'node:test';
import assert from 'node:assert/strict';
import {findAnswer,codingContractTypesMetadata} from '../Tasks/contractor.js.solver.js';
import {jsonReplacer} from '../helpers.js';

// Independent, bounded oracles. No production solver supplies an expected answer.
// Each type has its own seed, so failures reproduce without depending on test order.
const samples=80,checked=new Set();let checks=0;
function random(seed){return (lo,hi)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return lo+Math.floor(seed/0x100000000*(hi-lo+1));};}
const encode=x=>JSON.stringify(x,jsonReplacer);
function suite(type,body){checked.add(type);test('seeded independent oracle: '+type,()=>{
 let seed=2166136261;for(const c of type)seed=Math.imul(seed^c.charCodeAt(0),16777619)>>>0;
 const rng=random(seed);for(let i=0;i<samples;i++){let input;try{body(rng,(data)=>{input=data;checks++;return findAnswer({type,dataJson:encode(data)});},i);}catch(error){error.message=type+' seed='+seed+' case='+i+' input='+encode(input)+': '+error.message;throw error;}}
});}
const array=(rng,n,lo=0,hi=9)=>Array.from({length:n},()=>rng(lo,hi));
const matrix=(rng,rows,cols,hi=1)=>Array.from({length:rows},()=>array(rng,cols,0,hi));
const prime=n=>n>=2&&Array.from({length:Math.max(0,Math.floor(Math.sqrt(n))-1)},(_,i)=>i+2).every(d=>n%d!==0);
suite('Find Largest Prime Factor',(r,solve,i)=>{const n=i<4?[2,4,49,9973][i]:r(2,5000);let expected=1;for(let d=2;d<=n;d++)if(n%d===0&&prime(d))expected=d;assert.equal(solve(n),expected,'n='+n);});
suite('Subarray with Maximum Sum',(r,solve)=>{const a=array(r,r(1,10),-15,15);let expected=-Infinity;for(let i=0;i<a.length;i++)for(let j=i+1;j<=a.length;j++)expected=Math.max(expected,a.slice(i,j).reduce((x,y)=>x+y,0));assert.equal(solve(a),expected,encode(a));});
function partitions(n,coins,index=0){if(n===0)return 1;if(index===coins.length)return 0;let count=0;for(let used=0;used<=n;used+=coins[index])count+=partitions(n-used,coins,index+1);return count;}
suite('Total Ways to Sum',(r,solve)=>{const n=r(2,18);assert.equal(solve(n),partitions(n,Array.from({length:n-1},(_,i)=>i+1)));});
suite('Total Ways to Sum II',(r,solve)=>{const n=r(1,20),coins=[...new Set(array(r,r(1,5),1,9))];assert.equal(solve([n,coins]),partitions(n,coins));});
suite('Spiralize Matrix',(r,solve)=>{const rows=r(1,5),cols=r(1,5),m=matrix(r,rows,cols,100),seen=new Set(),out=[];let y=0,x=0,d=0;const dirs=[[0,1],[1,0],[0,-1],[-1,0]];for(let i=0;i<rows*cols;i++){out.push(m[y][x]);seen.add(y+','+x);let [dy,dx]=dirs[d];if(y+dy<0||y+dy>=rows||x+dx<0||x+dx>=cols||seen.has((y+dy)+','+(x+dx))){d=(d+1)%4;[dy,dx]=dirs[d];}y+=dy;x+=dx;}assert.deepEqual(solve(m),out);});
function jumpDistances(a){const d=Array(a.length).fill(Infinity);d[0]=0;for(let k=1;k<=a.length;k++)for(let i=0;i<a.length;i++)for(let j=i+1;j<=Math.min(a.length-1,i+a[i]);j++)d[j]=Math.min(d[j],d[i]+1);return d.at(-1);}
for(const type of ['Array Jumping Game','Array Jumping Game II'])suite(type,(r,solve)=>{const a=array(r,r(1,10),0,4),d=jumpDistances(a);assert.equal(Number(solve(a)),type.endsWith('II')?(Number.isFinite(d)?d:0):Number(Number.isFinite(d)),encode(a));});
suite('Merge Overlapping Intervals',(r,solve)=>{const a=Array.from({length:r(1,8)},()=>{const n=r(0,12);return [n,n+r(0,5)];});const result=solve(a);const coverage=xs=>Array.from({length:35},(_,i)=>xs.some(([l,h])=>l<=i/2&&i/2<=h));assert.deepEqual(coverage(result),coverage(a));for(let i=1;i<result.length;i++)assert.ok(result[i-1][1]<result[i][0]);});
suite('Generate IP Addresses',(r,solve)=>{const str=array(r,r(4,12)).join(''),expected=[];for(let i=1;i<str.length;i++)for(let j=i+1;j<str.length;j++)for(let k=j+1;k<str.length;k++){const parts=[str.slice(0,i),str.slice(i,j),str.slice(j,k),str.slice(k)];if(parts.every(p=>/^(0|[1-9][0-9]{0,2})$/.test(p)&&Number(p)<=255))expected.push(parts.join('.'));}assert.deepEqual(solve(str).sort(),expected.sort());});
function trade(prices,k,day=0,held=false,memo=new Map()){
 if(day===prices.length)return held?-Infinity:0;if(k===0)return held?-Infinity:0;
 const key=[k,day,held].join();if(memo.has(key))return memo.get(key);
 const rest=trade(prices,k,day+1,held,memo),act=held?prices[day]+trade(prices,k-1,day+1,false,memo):-prices[day]+trade(prices,k,day+1,true,memo);
 const v=Math.max(rest,act);memo.set(key,v);return v;
}
for(const [type,k]of [['Algorithmic Stock Trader I',1],['Algorithmic Stock Trader II',20],['Algorithmic Stock Trader III',2],['Algorithmic Stock Trader IV',null]])suite(type,(r,solve)=>{const prices=array(r,r(1,9),1,25),limit=k??r(0,5);assert.equal(solve(k===null?[limit,prices]:prices),trade(prices,limit),encode({prices,limit}));});
suite('Minimum Path Sum in a Triangle',(r,solve)=>{const t=Array.from({length:r(1,7)},(_,i)=>array(r,i+1,-5,15));const walk=(i,j)=>i===t.length?0:t[i][j]+Math.min(walk(i+1,j),walk(i+1,j+1));assert.equal(solve(t),walk(0,0));});
function paths(g,y=0,x=0){if(y>=g.length||x>=g[0].length||g[y][x])return 0;if(y===g.length-1&&x===g[0].length-1)return 1;return paths(g,y+1,x)+paths(g,y,x+1);}
suite('Unique Paths in a Grid I',(r,solve)=>{const h=r(1,6),w=r(1,6);assert.equal(solve([h,w]),paths(Array.from({length:h},()=>Array(w).fill(0))));});
suite('Unique Paths in a Grid II',(r,solve)=>{const g=matrix(r,r(1,6),r(1,6));g[0][0]=0;g.at(-1)[g[0].length-1]=0;assert.equal(solve(g),paths(g));});
// Repeated relaxation is independent of the production BFS and does not choose the same path.
function shortest(g){const h=g.length,w=g[0].length,d=Array.from({length:h},()=>Array(w).fill(Infinity));d[0][0]=0;for(let k=0;k<h*w;k++)for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(!g[y][x])for(const[dy,dx]of [[0,1],[1,0],[0,-1],[-1,0]])if(d[y+dy]?.[x+dx]!==undefined&&!g[y+dy][x+dx])d[y+dy][x+dx]=Math.min(d[y+dy][x+dx],d[y][x]+1);return d.at(-1).at(-1);}
suite('Shortest Path in a Grid',(r,solve)=>{const g=matrix(r,r(1,6),r(1,6));g[0][0]=0;g.at(-1)[g[0].length-1]=0;const p=solve(g),d=shortest(g);if(!Number.isFinite(d)){assert.equal(p,'');return;}assert.equal(p.length,d);let y=0,x=0;for(const c of p){const move={U:[-1,0],D:[1,0],L:[0,-1],R:[0,1]}[c];assert.ok(move);y+=move[0];x+=move[1];assert.equal(g[y]?.[x],0);}assert.equal(y,g.length-1);assert.equal(x,g[0].length-1);});
function balanced(s){let n=0;for(const c of s){n+=c==='('?1:c===')'?-1:0;if(n<0)return false;}return n===0;}
suite('Sanitize Parentheses in Expression',(r,solve)=>{const s=Array.from({length:r(1,9)},()=>['(',')','a'][r(0,2)]).join(''),valid=new Set();let best=Infinity;for(let mask=0;mask<2**s.length;mask++){let out='',removed=0,legal=true;for(let i=0;i<s.length;i++)if(mask&(1<<i)){if(s[i]==='a'){legal=false;break;}removed++;}else out+=s[i];if(!legal||removed>best||!balanced(out))continue;if(removed<best){best=removed;valid.clear();}valid.add(out);}assert.deepEqual(solve(s).sort(),[...valid].sort(),s);});
function expressions(digits,target){const out=[];function visit(i,expr){if(i===digits.length){const nums=expr.split(/[+*-]/);if(nums.some(n=>n.length>1&&n[0]==='0'))return;const terms=expr.match(/[+-]?[^+-]+/g)||[];const value=terms.reduce((sum,t)=>sum+t.split('*').map(Number).reduce((a,b)=>a*b,1),0);if(value===target)out.push(expr);return;}for(const sep of ['', '+','-','*'])visit(i+1,expr+sep+digits[i]);}visit(1,digits[0]);return out.sort();}
suite('Find All Valid Math Expressions',(r,solve)=>{const digits=array(r,r(1,6),0,5).join(''),n=r(-30,80);assert.deepEqual(solve([digits,n]).sort(),expressions(digits,n),encode([digits,n]));});
function hamming(n){const raw=n.toString(2).split('').map(Number),bits=[0];let k=0;for(let pos=1;k<raw.length;pos++)bits[pos]=(pos&(pos-1))===0?0:raw[k++];for(let p=1;p<bits.length;p*=2){let parity=0;for(let pos=1;pos<bits.length;pos++)if(pos&p)parity^=bits[pos];bits[p]=parity;}bits[0]=bits.slice(1).reduce((x,y)=>x^y,0);return bits.join('');}
suite('HammingCodes: Integer to Encoded Binary',(r,solve,i)=>{const n=i<3?[0,1,2][i]:r(0,2**30);assert.equal(solve(n),hamming(n),'n='+n);});
suite('HammingCodes: Encoded Binary to Integer',(r,solve)=>{const n=r(0,2**30),s=hamming(n);assert.equal(solve(s),n);for(let bit=0;bit<s.length;bit++)assert.equal(solve(s.slice(0,bit)+(s[bit]==='0'?'1':'0')+s.slice(bit+1)),n,'n='+n+' flip='+bit);});
suite('Proper 2-Coloring of a Graph',(r,solve)=>{const n=r(1,7),edges=[];for(let a=0;a<n;a++)for(let b=a+1;b<n;b++)if(r(0,3)===0)edges.push([a,b]);let possible=false;for(let mask=0;mask<2**n;mask++)if(edges.every(([a,b])=>((mask>>a)&1)!==((mask>>b)&1))){possible=true;break;}const answer=solve([n,edges]);if(!possible)assert.deepEqual(answer,[]);else{assert.equal(answer.length,n);assert.ok(answer.every(c=>c===0||c===1));assert.ok(edges.every(([a,b])=>answer[a]!==answer[b]));}});
const text=r=>Array.from({length:r(1,22)},()=>['A','B','C','1'][r(0,3)]).join('');
suite('Compression I: RLE Compression',(r,solve,i)=>{const s=i===0?'A'.repeat(27):text(r),encoded=solve(s);let decoded='';for(let i=0;i<encoded.length;i+=2){assert.match(encoded[i],/^[1-9]$/);decoded+=encoded[i+1].repeat(Number(encoded[i]));}assert.equal(decoded,s);let minimum=0;for(const run of s.match(/(.)\1*/g)||[])minimum+=2*Math.ceil(run.length/9);assert.equal(encoded.length,minimum);});
function decodeLz(s){let out='',literal=true;for(let i=0;i<s.length;){const n=Number(s[i++]);assert.ok(Number.isInteger(n)&&n>=0&&n<=9);if(n){if(literal){assert.ok(i+n<=s.length);out+=s.slice(i,i+n);i+=n;}else{const offset=Number(s[i++]);assert.ok(offset>=1&&offset<=9&&offset<=out.length);for(let j=0;j<n;j++)out+=out[out.length-offset];}}literal=!literal;}return out;}
// Exhaustively relax legal literal/reference tokens, including zero-length mode changes.
function optimalLzLength(s){const dist=Array.from({length:s.length+1},()=>[Infinity,Infinity]);dist[0][0]=0;for(let round=0;round<2*(s.length+1);round++)for(let pos=0;pos<=s.length;pos++)for(let mode=0;mode<2;mode++){
 const cost=dist[pos][mode];dist[pos][1-mode]=Math.min(dist[pos][1-mode],cost+1);
 for(let len=1;len<=9&&pos+len<=s.length;len++)if(mode===0)dist[pos+len][1]=Math.min(dist[pos+len][1],cost+1+len);else for(let off=1;off<=9&&off<=pos;off++)if(Array.from({length:len},(_,j)=>s[pos+j]===s[pos+j-off]).every(Boolean))dist[pos+len][0]=Math.min(dist[pos+len][0],cost+2);
 }return Math.min(...dist[s.length]);}
suite('Compression II: LZ Decompression',(r,solve,i)=>{const letters=text(r);let encoded='';for(let pos=0;pos<letters.length;){const n=Math.min(r(1,9),letters.length-pos);encoded+=(encoded?'0':'')+n+letters.slice(pos,pos+n);pos+=n;}if(i%2===0)encoded='1A'+r(1,9)+'1';assert.equal(solve(encoded),decodeLz(encoded),encoded);});
suite('Compression III: LZ Compression',(r,solve,i)=>{const s=i===0?'A'.repeat(20):text(r),answer=solve(s);assert.equal(decodeLz(answer),s,s);assert.equal(answer.length,optimalLzLength(s),s);});
suite('Encryption I: Caesar Cipher',(r,solve)=>{const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ',s=Array.from({length:r(1,30)},()=>r(0,5)===0?' ':alphabet[r(0,25)]).join(''),shift=r(0,25),expected=[...s].map(c=>c===' '?c:alphabet[(alphabet.indexOf(c)-shift+26)%26]).join('');assert.equal(solve([s,shift]),expected);});
suite('Encryption II: Vigenère Cipher',(r,solve)=>{const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ',s=Array.from({length:r(1,30)},()=>alphabet[r(0,25)]).join(''),key=Array.from({length:r(1,7)},()=>alphabet[r(0,25)]).join('');const expected=[...s].map((c,i)=>alphabet[(alphabet.indexOf(c)+alphabet.indexOf(key[i%key.length]))%26]).join('');assert.equal(solve([s,key]),expected);});
function root(n){let lo=0n,hi=n+1n;while(hi-lo>1n){const m=(lo+hi)/2n;if(m*m<=n)lo=m;else hi=m;}return n-lo*lo>lo?lo+1n:lo;}
suite('Square Root',(r,solve,i)=>{const n=i<7?BigInt(i):BigInt(array(r,r(1,90),0,9).join(''));assert.equal(BigInt(solve(n)),root(n),String(n));});
suite('Largest Rectangle in a Matrix',(r,solve)=>{const g=matrix(r,r(1,5),r(1,5));g[0][0]=0;let best=0;for(let y=0;y<g.length;y++)for(let x=0;x<g[0].length;x++)for(let y2=y;y2<g.length;y2++)for(let x2=x;x2<g[0].length;x2++){let empty=true;for(let i=y;i<=y2;i++)for(let j=x;j<=x2;j++)if(g[i][j])empty=false;if(empty)best=Math.max(best,(y2-y+1)*(x2-x+1));}const [[y,x],[y2,x2]]=solve(g);assert.ok(y>=0&&x>=0&&y2<g.length&&x2<g[0].length&&y2>=y&&x2>=x);assert.equal((y2-y+1)*(x2-x+1),best);for(let i=y;i<=y2;i++)for(let j=x;j<=x2;j++)assert.equal(g[i][j],0);});
suite('Total Number of Primes',(r,solve)=>{const lo=r(2,10000),hi=lo+r(0,150);let n=0;for(let v=lo;v<=hi;v++)if(prime(v))n++;assert.equal(solve([lo,hi]),n,encode([lo,hi]));});
test('independent checks cover every production contract solver',()=>{assert.deepEqual([...checked].sort(),codingContractTypesMetadata.map(m=>m.name).sort());console.log('Independent contract checks: '+checks+' solver calls across '+checked.size+' types; 80 seeded cases per type.');});
