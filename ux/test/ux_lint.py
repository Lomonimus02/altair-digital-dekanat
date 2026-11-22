"""UX lint for Altair — fails on orphan wraps / separator glyphs / ISO dates / English in key item components.
Usage: python3 ux_lint.py [--base URL] [--legacy]
  default : checks the shared components from SPEC-ux-hierarchy.md ([data-ui] items and their [data-ui-part] parts)
  --legacy: also checks today's cards (.glass, li, table cells) so the current build can be measured before the refactor
Exit code 1 if any violation. Read-only: every non-GET /api request is aborted."""
import json, sys, argparse
from urllib.parse import quote
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser(); ap.add_argument("--base", default="https://dekanat.213-171-10-37.sslip.io"); ap.add_argument("--legacy", action="store_true"); ap.add_argument("--json", default="")
a = ap.parse_args(); B = a.base
ACC = {"student": ("sorokin.mo", "Altair-student-31"), "teacher": ("orlov.pn", "Altair-teacher-58"), "staff": ("lebedeva.ip", "Altair-staff-204")}
J = f"/teach/journal?group={quote('БИ-3-26-04')}&discipline={quote('Базы данных')}"
PAGES = {"student": ["/", "/schedule", "/homework", "/homework/10", "/grades?view=table", "/grades?view=list", "/grades?view=summary", "/notifications", "/requests", "/requests/5", "/profile"],
         "teacher": ["/teach", "/schedule", J, "/teach/homework", "/teach/homework/5", "/notifications", "/profile"],
         "staff": ["/staff", "/staff/requests/5", "/staff/announcements", "/notifications", "/profile"]}
CHECK = r"""
(legacy) => {
  const SEP = /[·•→×|]/u, GLY = /^[·•→←\/×|—–:;,]+$/u, ISO = /\b\d{4}-\d{2}-\d{2}\b/, ENG = /\b(?!PDF\b|SQL\b|SELECT\b|JOIN\b)[A-Za-z][A-Za-z_]{2,}\b/;
  const out = [];
  const lines = (el) => { const tops = new Map(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const re = /\S+/g; let m; while ((m = re.exec(n.textContent))) { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
      const q = r.getClientRects()[0]; if (!q || !q.width) continue; const t = Math.round(q.top / 4); if (!tops.has(t)) tops.set(t, []); tops.get(t).push(m[0]); } }
    return [...tops.entries()].sort((x, y) => x[0] - y[0]).map(e => e[1]); };
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; };
  const own = (el) => [...el.childNodes].some(c => c.nodeType === 3 && c.textContent.trim());
  const cand = legacy ? [...document.querySelectorAll('main *')].filter(e => own(e) && !e.closest('th') && !['SCRIPT','STYLE','OPTION','TEXTAREA','BUTTON','LABEL','INPUT','SELECT'].includes(e.tagName) && (e.innerText || '').length <= 220) : [...document.querySelectorAll('[data-ui-part]')];
  for (const el of cand) {
    if (!vis(el) || el.closest('nav') || el.closest('.sr-only')) continue;
    const part = el.getAttribute('data-ui-part') || 'legacy';
    const text = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (!text) continue;
    const L = lines(el); const v = [];
    const single = ['title', 'meta', 'chip', 'time', 'value', 'status'].includes(part) || (part === 'legacy' && text.length <= 32 && !el.querySelector('br,div,p'));
    if (single && L.length > 1 && part !== 'title') v.push('wraps');
    if (part === 'title' && L.length > 2) v.push('title>2 lines');
    if (L.length > 1 && L[L.length - 1].length === 1 && text.split(' ').length > 2) v.push('orphan:' + L[L.length - 1][0]);
    for (const l of L) { if (GLY.test(l[0])) v.push('glyph-start:' + l[0]); if (l !== L[L.length - 1] && GLY.test(l[l.length - 1])) v.push('glyph-end:' + l[l.length - 1]); }
    if (part !== 'legacy' && SEP.test(text)) v.push('separator-glyph');
    if (part === 'legacy' && (text.match(/[·•→×]/gu) || []).length >= 1) v.push('separator-glyph');
    if (ISO.test(text)) v.push('iso-date');
    if (ENG.test(text) && !el.closest('[data-ui-allow-latin]')) v.push('latin:' + text.match(ENG)[0]);
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis' && !el.getAttribute('title')) v.push('truncated-without-title');
    if (v.length) out.push({ part, text: text.slice(0, 90), v });
  }
  const items = document.querySelectorAll('[data-ui]').length;
  return { items, out };
}
"""
CHROME = r"""
() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const out = [];
  for (const input of document.querySelectorAll('input[type="date"]')) if (vis(input)) out.push('native-date');
  const root = document.querySelector('main') || document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.textContent || '').replace(/\s+/g, '');
    if (text === '‹' || text === '›' || text === '▸') out.push('stray-arrow:' + text);
  }
  const bar = document.querySelector('[data-journal-toolbar]');
  if (bar && window.innerWidth <= 430) {
    for (const el of bar.querySelectorAll('input, select, textarea')) if (vis(el) && !el.closest('[role="dialog"]')) out.push('toolbar-control');
  }
  for (const row of document.querySelectorAll('[data-toolbar-row]')) {
    const box = row.getBoundingClientRect();
    const kids = [...row.children].filter(vis);
    for (const kid of kids) {
      const r = kid.getBoundingClientRect();
      if (r.right > box.right + 1 || r.left < box.left - 1) out.push('row-overflow');
    }
    for (let i = 0; i < kids.length; i += 1) for (let j = i + 1; j < kids.length; j += 1) {
      const a = kids[i].getBoundingClientRect();
      const b = kids[j].getBoundingClientRect();
      const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const stack = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlap > 2 && stack > 2) out.push('row-overlap');
    }
  }
  return out;
}
"""

ITEM_OVERLAP = r"""
() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const out = [];
  for (const card of document.querySelectorAll('[data-ui]')) {
    const boxes = [...card.querySelectorAll('[data-ui-part="title"], button')].filter((el) => vis(el));
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxes[i].contains(boxes[j]) || boxes[j].contains(boxes[i])) continue;
      const a = boxes[i].getBoundingClientRect();
      const b = boxes[j].getBoundingClientRect();
      const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const stack = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlap > 2 && stack > 2) out.push('item-overlap:' + Math.round(overlap) + 'x' + Math.round(stack));
    }
  }
  return out;
}
"""

def chrome(pg, label):
    for item in pg.evaluate(CHROME):
        fails.append((label, item))

fails = []; report = {}
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", args=["--no-sandbox", "--disable-dev-shm-usage"])
    for role, pages in PAGES.items():
        for w in (360, 390, 412):
            ctx = br.new_context(viewport={"width": w, "height": 800}, is_mobile=True, has_touch=True, device_scale_factor=2, locale="ru-RU", timezone_id="Europe/Moscow")
            assert ctx.request.post(B + "/api/auth/login", data={"login": ACC[role][0], "password": ACC[role][1]}, headers={"Origin": B}).ok
            ctx.route("**/api/**", lambda r: r.abort() if r.request.method not in ("GET", "HEAD", "OPTIONS") and "/api/auth/" not in r.request.url else r.continue_())
            pg = ctx.new_page()
            for u in pages:
                pg.goto(B + u, wait_until="networkidle"); pg.wait_for_timeout(1000)
                res = pg.evaluate(CHECK, a.legacy)
                key = f"{role} {w} {u.split('?')[0] if 'journal' in u else u}"
                report[key] = res
                if w == 412:
                    for item in pg.evaluate(ITEM_OVERLAP): fails.append((key, item))
                if not a.legacy and res["items"] == 0 and u not in ("/profile",): fails.append((key, "no [data-ui] items rendered — page not migrated to shared item components"))
                for o in res["out"]: fails.append((key, f"{o['part']}: {o['v']} «{o['text']}»"))
                if "journal" in u or u.startswith("/grades") or u.startswith("/notifications"):
                    for theme in ("light", "dark"):
                        pg.evaluate("(name) => document.documentElement.classList.toggle('dark', name === 'dark')", theme)
                        pg.wait_for_timeout(150)
                        chrome(pg, f"{key} {theme}")
                        if "journal" in u:
                            for name, tag in (("Неделя", "week"), ("Месяц", "month"), ("Семестр", "term")):
                                pg.get_by_role("button", name=name, exact=True).click()
                                pg.wait_for_timeout(400)
                                chrome(pg, f"{key} {tag} {theme}")
                            pg.get_by_role("button", name="Даты", exact=True).click()
                            pg.wait_for_timeout(300)
                            chrome(pg, f"{key} range {theme}")
                            pg.keyboard.press("Escape")
                            pg.wait_for_timeout(150)
                    pg.evaluate("() => document.documentElement.classList.remove('dark')")
            ctx.close()
    br.close()
if a.json: json.dump(report, open(a.json, "w"), ensure_ascii=False, indent=1)
for k, m in fails[:400]: print("FAIL", k, "|", m)
print(f"{len(fails)} violation(s)")
sys.exit(1 if fails else 0)
