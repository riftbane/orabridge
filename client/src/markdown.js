// Parser Markdown per le risposte dell'assistente.
//
// Copre quello che i modelli usano davvero (e che VS Code mostra nella sua
// chat): titoli, paragrafi, elenchi anche annidati e con le checkbox,
// citazioni, righe orizzontali, tabelle GFM, blocchi di codice recintati e la
// formattazione inline. Restituisce un albero di nodi, così il rendering resta
// in React e non serve nessuna dipendenza esterna né `dangerouslySetInnerHTML`.
//
// Blocchi:
//   { type: 'heading', level, inline }
//   { type: 'para', inline }
//   { type: 'code', lang, code }
//   { type: 'hr' }
//   { type: 'quote', blocks }
//   { type: 'list', ordered, start, items: [{ task, blocks }] }
//   { type: 'table', head: [inline], align: [], rows: [[inline]] }
//
// Inline: stringhe semplici oppure
//   { type: 'code', text } | { type: 'link', href, children }
//   { type: 'strong' | 'em' | 'strike', children } | { type: 'br' }

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w+#./-]*)[^`]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*$/;
const HR_RE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE_RE = /^ {0,3}> ?(.*)$/;
const TABLE_SEP_RE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-*:?[ \t]*)*\|?[ \t]*$/;

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~>|]/;

// ---------------- inline ----------------

// Testo fra apici inversi: la sequenza di chiusura ha la stessa lunghezza.
function codeSpan(src, i) {
  let n = 0;
  while (src[i + n] === '`') n++;
  const marker = '`'.repeat(n);
  let from = i + n;
  for (;;) {
    const at = src.indexOf(marker, from);
    if (at < 0) return null;
    if (src[at + n] === '`') {
      from = at + n;
      while (src[from] === '`') from++;
      continue;
    }
    let text = src.slice(i + n, at);
    if (text.length > 1 && text.startsWith(' ') && text.endsWith(' ')) text = text.slice(1, -1);
    return { text, end: at + n };
  }
}

// [etichetta](url "titolo") — le parentesi bilanciate nell'url sono ammesse.
function link(src, i) {
  let depth = 0;
  let close = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '\\') {
      j++;
      continue;
    }
    if (src[j] === '[') depth++;
    else if (src[j] === ']') {
      depth--;
      if (!depth) {
        close = j;
        break;
      }
    }
  }
  if (close < 0 || src[close + 1] !== '(') return null;
  let depthP = 0;
  let end = -1;
  for (let j = close + 1; j < src.length; j++) {
    if (src[j] === '(') depthP++;
    else if (src[j] === ')') {
      depthP--;
      if (!depthP) {
        end = j;
        break;
      }
    }
  }
  if (end < 0) return null;
  const inner = src.slice(close + 2, end).trim();
  const href = inner.split(/\s+/)[0].replace(/^<|>$/g, '');
  if (!href) return null;
  return { label: src.slice(i + 1, close), href, end: end + 1 };
}

// Enfasi: *corsivo*, **grassetto**, ***entrambi***, ~~barrato~~.
function emphasis(src, i, prev) {
  const ch = src[i];
  if (ch !== '*' && ch !== '_' && ch !== '~') return null;
  let run = 0;
  while (src[i + run] === ch) run++;
  if (ch === '~') {
    if (run < 2) return null;
    run = 2;
  } else if (run > 3) {
    run = 3;
  }
  const next = src[i + run] || '';
  if (!next || /\s/.test(next)) return null;
  // Un asterisco attaccato a una chiusura (`count(*)`) non apre niente.
  if (ch === '*' && /[)\],;]/.test(next)) return null;
  // Gli underscore dentro una parola (NOME_TABELLA) non sono enfasi.
  if (ch === '_' && /[\w$]/.test(prev || '')) return null;
  const marker = ch.repeat(run);
  let from = i + run;
  for (;;) {
    const at = src.indexOf(marker, from);
    if (at < 0) return null;
    const before = src[at - 1];
    const after = src[at + run] || '';
    if (!/\s/.test(before) && !(ch === '_' && /[\w$]/.test(after))) {
      const tag = ch === '~' ? 'strike' : run === 1 ? 'em' : run === 2 ? 'strong' : 'both';
      return { tag, content: src.slice(i + run, at), end: at + run };
    }
    from = at + 1;
  }
}

// Url scritta per esteso, senza parentesi quadre: la punteggiatura finale
// resta fuori dal collegamento.
function bareUrl(src, i) {
  const m = /^(https?:\/\/|www\.)[^\s<>"')]+/.exec(src.slice(i));
  if (!m) return null;
  const raw = m[0].replace(/[.,;:!?]+$/, '');
  if (raw.length < 8) return null;
  return { href: raw.startsWith('www.') ? `https://${raw}` : raw, text: raw, end: i + raw.length };
}

export function parseInline(src) {
  const out = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = '';
    }
  };
  const add = (node) => {
    flush();
    out.push(node);
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && ESCAPABLE.test(src[i + 1] || '')) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n') {
      add({ type: 'br' });
      i++;
      continue;
    }
    if (ch === '`') {
      const c = codeSpan(src, i);
      if (c) {
        add({ type: 'code', text: c.text });
        i = c.end;
        continue;
      }
    }
    if (ch === '[') {
      const l = link(src, i);
      if (l) {
        add({ type: 'link', href: l.href, children: parseInline(l.label) });
        i = l.end;
        continue;
      }
    }
    if (ch === '<') {
      const m = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/.exec(src.slice(i));
      if (m) {
        add({ type: 'link', href: m[1], children: [m[1]] });
        i += m[0].length;
        continue;
      }
    }
    if ((ch === 'h' || ch === 'w') && !/[\w@/]/.test(src[i - 1] || '')) {
      const u = bareUrl(src, i);
      if (u) {
        add({ type: 'link', href: u.href, children: [u.text] });
        i = u.end;
        continue;
      }
    }
    const em = emphasis(src, i, src[i - 1]);
    if (em) {
      const children = parseInline(em.content);
      if (em.tag === 'both') add({ type: 'strong', children: [{ type: 'em', children }] });
      else add({ type: em.tag, children });
      i = em.end;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

// ---------------- blocchi ----------------

const isBlank = (l) => !l || !l.trim();

// Riga che interrompe un paragrafo perché apre un blocco di altro tipo.
function startsBlock(line, next) {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    QUOTE_RE.test(line) ||
    LIST_RE.test(line) ||
    isTableStart(line, next)
  );
}

function isTableStart(line, next) {
  return (
    !!line &&
    !!next &&
    line.includes('|') &&
    next.includes('-') &&
    TABLE_SEP_RE.test(next) &&
    next.includes('|')
  );
}

// Celle di una riga di tabella: le pipe protette da backslash restano testo.
function splitRow(line) {
  const cells = [];
  let cur = '';
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += s[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

function parseTable(lines, i) {
  const head = splitRow(lines[i]);
  const align = splitRow(lines[i + 1]).map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
  });
  let j = i + 2;
  const rows = [];
  while (j < lines.length && !isBlank(lines[j]) && lines[j].includes('|')) {
    const cells = splitRow(lines[j]);
    while (cells.length < head.length) cells.push('');
    rows.push(cells.slice(0, head.length).map((c) => parseInline(c)));
    j++;
  }
  return {
    block: {
      type: 'table',
      head: head.map((c) => parseInline(c)),
      align: align.slice(0, head.length),
      rows,
    },
    next: j,
  };
}

function parseList(lines, i) {
  const first = LIST_RE.exec(lines[i]);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const start = ordered ? Number(first[2].replace(/\D/g, '')) : 1;
  const items = [];
  let cur = null;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      // Riga vuota: l'elenco prosegue solo se dopo c'è ancora roba rientrata.
      const next = lines[i + 1];
      const m = next && LIST_RE.exec(next);
      const continues = next && ((m && m[1].length >= indent) || /^ {2,}\S/.test(next));
      if (!continues) break;
      if (cur) cur.lines.push('');
      i++;
      continue;
    }
    const m = LIST_RE.exec(line);
    if (m && m[1].length <= indent + 1) {
      if (m[1].length < indent) break;
      // Un elenco di tipo diverso allo stesso livello è un blocco nuovo.
      if (items.length && /\d/.test(m[2]) !== ordered) break;
      cur = { lines: [m[3]] };
      items.push(cur);
      i++;
      continue;
    }
    if (!cur) break;
    if (/^\s/.test(line)) {
      cur.lines.push(line.replace(new RegExp(`^ {0,${indent + 2}}`), ''));
      i++;
      continue;
    }
    // Riga non rientrata sotto un elenco: la si tiene come proseguimento del
    // punto corrente (i modelli mandano spesso testo a capo senza indentare).
    if (startsBlock(line, lines[i + 1])) break;
    cur.lines.push(line);
    i++;
  }
  return {
    block: {
      type: 'list',
      ordered,
      start,
      items: items.map((it) => {
        const task = /^\[([ xX])\]\s+/.exec(it.lines[0]);
        if (task) it.lines[0] = it.lines[0].slice(task[0].length);
        return { task: task ? task[1].toLowerCase() === 'x' : null, blocks: parseBlocks(it.lines) };
      }),
    },
    next: i,
  };
}

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const mark = fence[1][0];
      const close = new RegExp(`^ {0,3}${mark}{${fence[1].length},}[ \\t]*$`);
      const body = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // la riga di chiusura manca finché la risposta è in streaming
      blocks.push({ type: 'code', lang: fence[2] || '', code: body.join('\n') });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        inline: parseInline(heading[2]),
      });
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const inner = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        inner.push(QUOTE_RE.exec(lines[i])[1]);
        i++;
      }
      blocks.push({ type: 'quote', blocks: parseBlocks(inner) });
      continue;
    }

    if (isTableStart(line, lines[i + 1])) {
      const t = parseTable(lines, i);
      blocks.push(t.block);
      i = t.next;
      continue;
    }

    if (LIST_RE.test(line)) {
      const l = parseList(lines, i);
      // Nessun punto riconosciuto: evita il ciclo infinito trattando la riga
      // come testo normale.
      if (l.next > i) {
        blocks.push(l.block);
        i = l.next;
        continue;
      }
    }

    const para = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'para', inline: parseInline(para.join('\n')) });
  }
  return blocks;
}

export function parseMarkdown(text) {
  return parseBlocks(
    String(text ?? '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
  );
}
