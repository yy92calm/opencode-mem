#!/bin/bash
# End-to-end verification of the integrated memory features against the test Worker (:3999).
set -e
BASE=http://127.0.0.1:3999
AUTH='Authorization: Bearer test-key-123'
CT='Content-Type: application/json'

echo "== 1. health =="
curl -s $BASE/health; echo

echo "== 2. post raw batch =="
curl -s -X POST $BASE/api/raw -H "$AUTH" -H "$CT" -d '{"items":[
  {"session_id":"sess-aaaa1111","role":"user","content":"debugging the websocket reconnect issue","timestamp":"2026-08-08T10:00:00Z"},
  {"session_id":"sess-aaaa1111","role":"assistant","content":"the keepalive interval needs tuning","timestamp":"2026-08-08T10:01:00Z"}
]}'; echo

echo "== 3. post manual memory =="
curl -s -X POST $BASE/api/memory -H "$AUTH" -H "$CT" -d '{
  "type":"decision","title":"Websocket keepalive","content":"Keepalive interval must be 30s on mobile networks",
  "facts":["interval=30s"],"concepts":["websocket"]
}'; echo

echo "== 4. search with char_budget (tier-1 hit + usage bump) =="
curl -s "$BASE/api/memory/search?q=websocket&char_budget=8000" -H "$AUTH"; echo

echo "== 5. seed a daily summary + auto atom via sqlite for tier-2/dedup tests =="
node seed-test-data.mjs

echo "== 6. two-tier fallback: term only present in summary =="
curl -s "$BASE/api/memory/search?q=kubernetes&min_results=3" -H "$AUTH"; echo

echo "== 7. char_budget truncation (budget=60) =="
curl -s "$BASE/api/memory/search?q=websocket&char_budget=500&min_results=0" -H "$AUTH" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(JSON.stringify({items:j.items.length,truncated:j.truncated}))})'; echo

echo "== 8. PATCH status -> deprecated, then search must not hit =="
curl -s -X PATCH $BASE/api/memory/1 -H "$AUTH" -H "$CT" -d '{"status":"deprecated"}'; echo
curl -s "$BASE/api/memory/search?q=websocket&min_results=0" -H "$AUTH" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("active results:",j.items.filter(i=>typeof i.id==="number").length)})'

echo "== 9. include_deprecated list =="
curl -s "$BASE/api/memory?include_deprecated=1" -H "$AUTH" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("total with deprecated:",j.items.length,"deprecated:",j.items.filter(i=>i.status==="deprecated").length)})'

echo "== 10. skill drafts: list -> approve -> list =="
curl -s "$BASE/api/skills/drafts" -H "$AUTH"; echo
curl -s -X POST $BASE/api/skills/drafts/1/approve -H "$AUTH" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(JSON.stringify({id:j.id,status:j.status,title:j.title}))})'
curl -s "$BASE/api/skills/drafts?status=approved" -H "$AUTH" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("approved drafts:",j.items.length)})'

echo "== 11. manual insert supersedes same-title auto atom =="
curl -s -X POST $BASE/api/memory -H "$AUTH" -H "$CT" -d '{
  "type":"fact","title":"Auto Atom From Session","content":"user-asserted override"
}' > /dev/null
node -e '
import("better-sqlite3").then(({default:Database})=>{
  const db=new Database("./data/test-memory.db");
  const rows=db.prepare("SELECT id,source,status FROM hard_memories WHERE title=?").all("Auto Atom From Session");
  console.log(JSON.stringify(rows));
});'

echo "== 12. CJK search: 4-char term via trigram MATCH =="
curl -s "$BASE/api/memory/search?q=%E6%9E%84%E5%BB%BA%E5%B7%A5%E5%85%B7&min_results=0" -H "$AUTH" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("hits for 构建工具:",j.items.filter(i=>i.title==="项目构建偏好").length)})'

echo "== 13. CJK search: 2-char term via LIKE fallback =="
curl -s "$BASE/api/memory/search?q=%E7%A6%81%E6%AD%A2&min_results=0" -H "$AUTH" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("hits for 禁止:",j.items.filter(i=>i.title==="项目构建偏好").length)})'

echo "== 14. CJK mixed query (ascii + chinese) =="
curl -s "$BASE/api/memory/search?q=webpack%20%E6%9E%84%E5%BB%BA&min_results=0" -H "$AUTH" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("hits for webpack+构建:",j.items.filter(i=>i.title==="项目构建偏好").length)})'

echo "== 15. CJK tier-2: term only in a Chinese summary =="
curl -s "$BASE/api/memory/search?q=%E6%95%B0%E6%8D%AE%E5%BA%93%E8%BF%81%E7%A7%BB&min_results=3" -H "$AUTH" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("summary hits:",j.items.filter(i=>String(i.id).startsWith("summary:")).length)})'

echo "== 16. stats endpoint =="
curl -s "$BASE/api/memory/stats" -H "$AUTH"; echo

echo "ALL CHECKS DONE"
