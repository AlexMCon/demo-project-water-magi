/* Pure parsing/comparison logic, shared by the extension and Node tests. */
(() => {
  'use strict';
  const extensions = /\.(webp|png|jpe?g|avif|gif|bmp)$/i;
  const chapter = s => {
    if (!/^\d+(?:\.\d+)?$/.test(String(s).trim())) throw Error(`Capitol invalid: ${s}`);
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) throw Error(`Capitol invalid: ${s}`);
    return String(n);
  };
  function parsePlan(text) {
    const plan = Object.create(null);
    for (const row of text.split(/[;\n]/).map(s => s.trim()).filter(Boolean)) {
      const match = row.match(/^(\d+(?:\.\d+)?)\s*:\s*(.+)$/);
      if (!match) throw Error(`Linie invalidă: ${row}. Exemplu: 136: 7, 9-11 sau 183: *`);
      const cap = chapter(match[1]), value = match[2].trim();
      if (value === '*') { plan[cap] = '*'; continue; }
      const pages = new Set(Array.isArray(plan[cap]) ? plan[cap] : []);
      for (const token of value.split(',').map(s => s.trim())) {
        const range = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!range) throw Error(`Pagină invalidă: ${token}`);
        const a = Number(range[1]), b = Number(range[2] || range[1]);
        if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 1 || b < a || b > 10000) throw Error(`Interval invalid: ${token}`);
        for (let p = a; p <= b; p++) pages.add(p);
      }
      if (plan[cap] !== '*') plan[cap] = [...pages].sort((a,b)=>a-b);
    }
    return plan;
  }
  function compareFiles(names, total) {
    if (!Number.isSafeInteger(total) || total < 1 || total > 10000) throw Error('Total API invalid');
    const found = new Map(), unexpected = [];
    for (const name of names) {
      if (!extensions.test(name)) continue;
      const m = name.match(/^(\d+)\.[^.]+$/);
      if (!m || Number(m[1]) < 1 || Number(m[1]) > total) { unexpected.push(name); continue; }
      const n = Number(m[1]);
      found.set(n, [...(found.get(n) || []), name]);
    }
    return { missing: Array.from({length:total},(_,i)=>i+1).filter(n=>!found.has(n)),
      duplicates: [...found].filter(([,v])=>v.length>1).map(([page,names])=>({page,names})), unexpected,
      present: found.size };
  }
  function requestedPages(value, total) {
    const pages = value === '*' ? Array.from({length:total},(_,i)=>i+1) : value || [];
    if (pages.some(p=>!Number.isSafeInteger(p)||p<1||p>total)) throw Error(`Planul cere pagini după totalul API (${total})`);
    return pages;
  }
  function sourceKey(ch) {
    const id = ch.groupId ?? ch.group?.id;
    if (id !== undefined && id !== null) return `group:${id}`;
    const name = ch.group?.name;
    if (name) return `name:${name}`;
    throw Error('API-ul nu identifică sursa; opresc pentru a nu amesteca edițiile');
  }
  function formatPlan(plan) {
    return Object.entries(plan).sort(([a],[b])=>Number(a)-Number(b)).map(([c,p])=>`${c}: ${p==='*'?'*':p.join(', ')}`).join('\n');
  }
  const api = {chapter,parsePlan,compareFiles,requestedPages,sourceKey,formatPlan};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.__wmRepairCore = api;
})();
