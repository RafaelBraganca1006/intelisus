// Extrai textos em português de src/**/*.tsx e (opcionalmente) reescreve o código com t("...").
// Uso: node scripts/i18n-extrair.mjs            -> relatório (src/i18n/candidatos.json), não altera nada
//      node scripts/i18n-extrair.mjs --aplicar  -> reescreve os .tsx e grava src/i18n/pt-chaves.json
// A chave é o próprio texto em português; {0}, {1}... são os trechos interpolados.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const APLICAR = process.argv.includes('--aplicar');
const SRC = path.resolve('src');
const ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label', 'aria-description']);
const IGNORA_ARQ = /(\.test\.|[\\/]engine[\\/](motor|simulador|worker)|Logo\.tsx|lib[\\/]formato|[\\/]i18n[\\/])/;
// textos em minúsculas que o detector de prosa não pega (por arquivo; ids não entram aqui)
const FORCA = { 'components/Leque.tsx': ['hoje'], 'views/Panorama.tsx': ['nenhum', 'residentes', 'neste dia'], 'views/Simulador.tsx': ['desligada', 'atual', 'estadual', 'melhora', 'piora'], 'views/Planejamento.tsx': ['pico sazonal'] };
const BLOCK_ATTR = new Set(['className', 'key', 'style', 'id', 'type', 'value', 'name', 'href', 'src', 'rel', 'target', 'viewBox', 'd', 'fill', 'stroke', 'transform', 'points', 'xmlns', 'role', 'htmlFor', 'min', 'max', 'step', 'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'x2', 'y1', 'y2', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'cor', 'color', 'nivel', 'ref', 'as', 'lang', 'charSet', 'content', 'media', 'tipo']);
const attrOk = (n) => ATTRS.has(n) || (!BLOCK_ATTR.has(n) && !n.startsWith('data-') && !/^on[A-Z]/.test(n));
const CHAMADAS_IGNORADAS = new Set(['tx', 'querySelector', 'querySelectorAll', 'getElementById', 'addEventListener', 'removeEventListener',
  'getItem', 'setItem', 'removeItem', 'fetch', 'createElement', 'getAttribute', 'setAttribute', 'matchMedia', 'getLayoutProperty',
  'setLayoutProperty', 'setPaintProperty', 'getSource', 'getLayer', 'addSource', 'addLayer', 'on', 'off', 'once', 'log', 'warn', 'error',
  'Error', 'import', 'require', 'NumberFormat', 'toLocaleString', 'toLocaleDateString', 'startsWith', 'endsWith', 'includes', 'split',
  'replace', 'replaceAll', 'padStart', 'padEnd', 'join', 'test', 'match', 'has', 'get', 'set', 'delete', 'resize', 'dispatchAction', 'setFeatureState',
  'queryRenderedFeatures', 'getCanvas', 'isStyleLoaded', 'flyTo', 'fitBounds', 'easeTo', 'dataset']);

const arquivos = [];
(function varre(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) varre(p);
    else if (/\.tsx?$/.test(e.name) && !IGNORA_ARQ.test(p)) arquivos.push(p);
  }
})(SRC);

const temLetraPT = (s) => /\p{L}/u.test(s);
const pareceCodigo = (s) =>
  /^(https?:|\/|\.|#|data:|rgba?\(|hsl|var\(|M[0-9 .,-]|[a-z]+:[a-z-]+$)/.test(s) || /^[a-z0-9_\-:.\/%\[\]()=,;{}#@ +*>~|&!?]*$/.test(s) && !/\s[a-z]{3,}\s/.test(s) && !/[ãõçáéíóúâêô]/i.test(s);

/** Texto "de prosa": tem acento, ou espaço entre palavras, ou começa com maiúscula. */
function pareceTexto(s) {
  const t = s.trim();
  if (!t || !temLetraPT(t)) return false;
  if (/[ãõçáéíóúâêôà]/i.test(t)) return true;
  if (/\s/.test(t) && /[A-Za-z]{2,}/.test(t) && !pareceCodigo(t)) return true;
  if (/^[A-Z][a-z]{2,}$/.test(t)) return true; // palavra única capitalizada ("Geral")
  return false;
}

const cand = { auto: {}, incerto: {} };
const reg = (bucket, texto, arq) => { (cand[bucket][texto] ??= new Set()).add(path.relative(SRC, arq)); };

const cmp = new Set();
function emStyle(n) { for (let a = n.parent; a; a = a.parent) if (ts.isJsxAttribute(a)) return a.name.getText() === 'style'; return false; }
function ehContextoIgnorado(n) {
  const p = n.parent;
  if (!p) return true;
  if (emStyle(n)) return true;
  if ((ts.isCaseClause(p) || ts.isBinaryExpression(p) && ['===', '!==', '==', '!='].includes(p.operatorToken.getText())) && (ts.isStringLiteral(n))) cmp.add(n.text);
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
  if (ts.isCaseClause(p) || ts.isEnumMember(p) || ts.isTypeAliasDeclaration(p) || ts.isModuleDeclaration(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === n) return true;
  if (ts.isBinaryExpression(p) && ['===', '!==', '==', '!='].includes(p.operatorToken.getText())) return true;
  if (ts.isCallExpression(p) && p.arguments.includes(n)) {
    const f = p.expression;
    const nome = ts.isPropertyAccessExpression(f) ? f.name.text : ts.isIdentifier(f) ? f.text : '';
    if (CHAMADAS_IGNORADAS.has(nome)) return true;
  }
  if (ts.isNewExpression(p) && p.arguments?.includes(n)) return true;
  if (ts.isJsxAttribute(p) && !attrOk(p.name.getText())) return true;
  if (ts.isPropertyAssignment(p) && /^(color|background|fill|stroke|type|trigger|position|formatter|id|key|name|class|className|font\w*|align|orient|width|height|symbol|areaStyle|lineStyle|axisPointer|animation|renderer|source|layer|paint|layout|filter|visibility|minzoom|maxzoom)$/.test(p.name.getText())) return true;
  return false;
}

/** Converte TemplateExpression em chave com {0},{1} e lista de expressões. */
function chaveTemplate(n, sf) {
  let key = n.head.text; const exprs = [];
  n.templateSpans.forEach((s, i) => { key += `{${i}}` + s.literal.text; exprs.push(s.expression.getText(sf)); });
  return { key, exprs };
}

function aplicaEm(code, edits, ini, fim) {
  let out = code.slice(ini, fim);
  const dentro = edits.filter((e) => e.start >= ini && e.end <= fim).sort((a, b) => b.start - a.start);
  for (const e of dentro) out = out.slice(0, e.start - ini) + e.texto + out.slice(e.end - ini);
  return out;
}

function processa(arq) {
  const code = fs.readFileSync(arq, 'utf8');
  const sf = ts.createSourceFile(arq, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = []; // {start,end,texto}
  const js = (s) => JSON.stringify(s);
  const chamada = (key, exprs = []) => `tx(${js(key)}${exprs.length ? ', ' + exprs.join(', ') : ''})`;

  (function visita(n) {
    if (ts.isJsxText(n)) {
      const raw = n.getText(sf);
      const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
      const core = m[2].replace(/\s+/g, ' ');
      if (core && temLetraPT(core) && !/&\w+;/.test(core)) {
        reg('auto', core, arq);
        const ini = n.getStart(sf) + m[1].length;
        edits.push({ start: ini, end: ini + m[2].length, texto: `{${chamada(core)}}` });
      } else if (core && /&\w+;/.test(core)) reg('incerto', '[ENTIDADE] ' + core, arq);
      return;
    }
    if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && attrOk(n.name.getText())) {
      const s = n.initializer.text;
      if (temLetraPT(s) && (ATTRS.has(n.name.getText()) || pareceTexto(s))) { reg('auto', s, arq); edits.push({ start: n.initializer.getStart(sf), end: n.initializer.getEnd(), texto: `{${chamada(s)}}` }); }
      return;
    }
    if (ts.isJsxAttribute(n) && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression && ATTRS.has(n.name.getText())) {
      // title={`...${x}`} ou title={'...'} cai no tratamento genérico abaixo
    }
    const textoDe = (nn) => {
      if (ts.isStringLiteral(nn) || ts.isNoSubstitutionTemplateLiteral(nn)) return { key: nn.text, exprs: [] };
      if (ts.isTemplateExpression(nn)) return chaveTemplate(nn, sf);
      return null;
    };
    if (ts.isTemplateExpression(n)) {
      n.templateSpans.forEach((sp) => visita(sp.expression)); // textos aninhados primeiro
      if (ts.isJsxAttribute(n.parent) || ehContextoIgnorado(n)) return;
      const dentroJsxAttr = ts.isJsxExpression(n.parent) && ts.isJsxAttribute(n.parent.parent);
      if (dentroJsxAttr && !attrOk(n.parent.parent.name.getText())) return;
      const ini = n.getStart(sf), fim = n.getEnd();
      let key = n.head.text; const exprs = [];
      n.templateSpans.forEach((sp, i) => {
        key += `{${i}}` + sp.literal.text;
        exprs.push(aplicaEm(code, edits, sp.expression.getStart(sf), sp.expression.getEnd()));
      });
      const bucket = temLetraPT(key.replace(/\{\d+\}/g, '')) && pareceTexto(key.replace(/\{\d+\}/g, '')) ? 'auto' : 'incerto';
      reg(bucket, key, arq);
      if (bucket === 'auto') {
        for (let i = edits.length - 1; i >= 0; i--) if (edits[i].start >= ini && edits[i].end <= fim) edits.splice(i, 1);
        edits.push({ start: ini, end: fim, texto: chamada(key, exprs) });
      }
      return;
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (ts.isJsxAttribute(n.parent) && n.parent.initializer === n) return;
      if (ehContextoIgnorado(n)) return;
      const key = n.text;
      if (!temLetraPT(key)) return;
      const dentroJsxAttr = ts.isJsxExpression(n.parent) && ts.isJsxAttribute(n.parent.parent);
      if (dentroJsxAttr && !attrOk(n.parent.parent.name.getText())) return;
      const forca = (FORCA[path.relative(SRC, arq).replace(/\\/g, '/')] ?? []).includes(key);
      const bucket = forca || pareceTexto(key) ? 'auto' : 'incerto';
      reg(bucket, key, arq);
      if (bucket === 'auto') edits.push({ start: n.getStart(sf), end: n.getEnd(), texto: chamada(key) });
      return;
    }
    ts.forEachChild(n, visita);
  })(sf);

  if (!APLICAR || !edits.length) return { edits: edits.length };
  // aplica de trás para frente; descarta edições aninhadas
  edits.sort((a, b) => b.start - a.start);
  let out = code; let ult = Infinity;
  for (const e of edits) { if (e.end > ult) continue; out = out.slice(0, e.start) + e.texto + out.slice(e.end); ult = e.start; }
  if (!/from '(\.\.?\/)+i18n'/.test(out)) {
    const prof = path.relative(path.dirname(arq), path.join(SRC, 'i18n')).replace(/\\/g, '/');
    const imp = `import { tx } from '${prof.startsWith('.') ? prof : './' + prof}';\n`;
    out = imp + out;
  }
  fs.writeFileSync(arq, out);
  return { edits: edits.length };
}

let total = 0;
for (const a of arquivos) total += processa(a).edits;
fs.mkdirSync(path.join(SRC, 'i18n'), { recursive: true });
const ser = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v]]));
if (APLICAR) 
fs.writeFileSync(path.join(SRC, 'i18n/candidatos.json'), JSON.stringify({ conflitos: Object.keys(cand.auto).filter((k) => cmp.has(k)), auto: Object.keys(cand.auto).length, incerto: ser(cand.incerto), autoLista: Object.keys(cand.auto) }, null, 1));
console.log(`${arquivos.length} arquivos · ${total} edições · ${Object.keys(cand.auto).length} textos únicos · ${Object.keys(cand.incerto).length} incertos`);
