#!/bin/sh
# Parallel matchup matrix: 4 processes x 2 seeds each, averaged.
cd "$(dirname "$0")/.."
B=${1:-1800}
for o in 0 10 20 30; do node tools/matchups.mjs $B 2 all $o --json > /tmp/mm_$o.json & done
wait
node -e '
const fs=require("fs");const R=[0,10,20,30].map(o=>JSON.parse(fs.readFileSync("/tmp/mm_"+o+".json")));
const types=Object.keys(R[0]);const pad=(s,n)=>(s+" ".repeat(n)).slice(0,n);
console.log(pad("",11)+types.map(t=>pad(t.slice(0,6),7)).join(""));
for(const a of types){let avg=0;const row=types.map(b=>{const v=R.reduce((s,r)=>s+r[a][b],0)/R.length;avg+=v;return pad(v.toFixed(2),7)}).join("");console.log(pad(a,11)+row+"  avg "+(avg/types.length).toFixed(2));}'
