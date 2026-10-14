// importar-planilha.mjs · ADEGA SB (e base dos próximos sistemas) · importa o catálogo da planilha do sistema antigo.
// Uso (PowerShell, na pasta do STAGING):
//   PRÉVIA (não grava nada):  node --env-file=.env.local scripts/importar-planilha.mjs "C:\caminho\Planilha1.xlsx"
//   GRAVAR no banco do .env:  node --env-file=.env.local scripts/importar-planilha.mjs "C:\caminho\Planilha1.xlsx" --gravar
//   + tirar o catálogo antigo/de teste da venda: acrescente --desativar-antigos (DESATIVA, não apaga: vendas antigas
//     continuam com o produto; quem estiver na planilha volta ativo com os dados novos)
//   (produção = mesmo comando com --env-file=C:\Projetos\adega-sb\.env.local, só DEPOIS de validar no staging)
// Sempre gera ao lado da planilha: <nome>-previa.csv (abre no Excel) com cada produto já tratado e o motivo de revisão.
// Regras (adega-sb-docs\PRD-novo-layout-e-importacao.md §2): estoque NÃO entra (decisão D1: zerado + inventário);
// custo médio sem vírgula é corrigido; "Cst" vira CSOSN; unidade padronizada; setor vira categoria; +18/fumígeno pelo NCM.
// Rodar de novo é seguro: atualiza pelo código de barras (ou pelo código antigo + nome), não duplica.
// Sem dependências: lê o .xlsx (zip + XML) só com o Node.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const arquivo = args.find((a) => !a.startsWith('--'));
const GRAVAR = args.includes('--gravar');
const DESATIVAR = args.includes('--desativar-antigos');
if (!arquivo || !fs.existsSync(arquivo)) {
  console.error('Uso: node --env-file=.env.local scripts/importar-planilha.mjs "C:\\caminho\\Planilha.xlsx" [--gravar]');
  process.exit(1);
}
const ORIGEM = 'planilha:' + path.basename(arquivo);

// ------------------------------------------------------------------ 1. ler o .xlsx (zip) sem biblioteca
function lerZip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('arquivo não é um .xlsx válido');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const arquivos = {};
  for (let i = 0; i < total; i++) {
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20);
    const nLen = buf.readUInt16LE(p + 28), xLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + nLen);
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dado = buf.subarray(ini, ini + tam);
    arquivos[nome] = metodo === 8 ? zlib.inflateRawSync(dado) : dado;
    p += 46 + nLen + xLen + cLen;
  }
  return arquivos;
}
const xmlTexto = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
function lerPlanilha(caminho) {
  const z = lerZip(fs.readFileSync(caminho));
  const compart = [];
  const ss = z['xl/sharedStrings.xml']?.toString('utf8') ?? '';
  for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    compart.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlTexto(t[1])).join(''));
  }
  const nomeAba = Object.keys(z).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  const xml = z[nomeAba].toString('utf8');
  const col = (ref) => [...ref.replace(/\d/g, '')].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const linhas = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const linha = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = c[1], corpo = c[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(at)[1];
      const tipo = /t="(\w+)"/.exec(at)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
      let val = null;
      if (tipo === 's') val = compart[+v];
      else if (tipo === 'inlineStr') val = xmlTexto(/<is>([\s\S]*?)<\/is>/.exec(corpo)?.[1] ?? '');
      else if (tipo === 'str') val = v != null ? xmlTexto(v) : null;
      else if (tipo === 'b') val = v === '1';
      else if (v != null) val = Number(v);
      linha[col(ref)] = val;
    }
    linhas.push(linha);
  }
  return linhas;
}

// ------------------------------------------------------------------ 2. regras de limpeza
const semAcento = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const txt = (v) => { if (v == null) return null; const s = String(v).replace(/_x000D_/g, '').replace(/\s+/g, ' ').trim(); return s || null; };
const dig = (v) => (v == null ? '' : String(typeof v === 'number' ? Math.round(v) : v).replace(/\D/g, ''));
function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function data(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v).trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
const UNIDADES = { UN: 'UN', UND: 'UN', UNID: 'UN', UNI: 'UN', UD: 'UN', U: 'UN', VD: 'UN', PE: 'UN', GL: 'UN', BD: 'UN',
  CX: 'CX', PC: 'PC', PCT: 'PCT', FD: 'FD', LT: 'LT', GR: 'GR', KG: 'KG', ML: 'ML', L: 'L', FR: 'FR', FRC: 'FR', GF: 'GF', GRF: 'GF', DZ: 'DZ' };
function unidade(v) {
  const s = String(v ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!s) return 'UN';
  if (UNIDADES[s]) return UNIDADES[s];
  for (const k of ['CX', 'FD', 'PCT', 'PC', 'FR']) if (s.startsWith(k)) return UNIDADES[k];
  return 'UN';
}
const ehEan = (d) => [8, 12, 13, 14].includes(d.length);
function corrigirCustoMedio(cm, custo) {
  // "7725" com custo 8,65 era 7,725: o sistema antigo exportou sem a vírgula
  if (cm == null || !Number.isInteger(cm) || cm < 1000 || !custo) return { valor: cm, corrigido: false };
  let melhor = cm, dif = Infinity;
  for (const div of [10, 100, 1000, 10000]) {
    const v = cm / div, d = Math.abs(v - custo) / custo;
    if (d < dif) { dif = d; melhor = v; }
  }
  return dif <= 0.5 ? { valor: melhor, corrigido: true } : { valor: null, corrigido: true };
}
function pelaNcm(ncm) {
  const cap = Number(String(ncm).slice(0, 4));
  const fumigeno = cap === 2402 || cap === 2403;
  return { adulto: fumigeno || (cap >= 2203 && cap <= 2208), fumigeno };
}

// ------------------------------------------------------------------ 3. transformar
const linhas = lerPlanilha(arquivo);
const cab = (linhas[0] ?? []).map((h) => semAcento(h ?? ''));
const idx = (nome) => cab.indexOf(semAcento(nome));
const C = Object.fromEntries(['Código', 'Código interno', 'Produto', 'Fornecedor', 'Setor', 'Fabricante', 'Preço de custo', 'Custo médio',
  'Preço de venda', 'Quantidade', 'Estoque mínimo', 'Unidade', 'Último reajuste', 'NCM', 'Ipi', 'Cst', 'Icms', 'Basecalculo',
  'Cean', 'Ceantrib', 'Cest', 'Cst_pis', 'Cst_cofins', 'Cprodanp', 'Observações'].map((n) => [n, idx(n)]));
for (const obrig of ['Código', 'Produto', 'Preço de venda']) {
  if (C[obrig] < 0) { console.error(`Coluna obrigatória não encontrada na planilha: "${obrig}"`); process.exit(1); }
}
const g = (l, nome) => (C[nome] >= 0 ? l[C[nome]] : null);

const eans = new Set();
const itens = [];
for (let i = 1; i < linhas.length; i++) {
  const l = linhas[i];
  if (!l || l.every((v) => v == null || v === '')) continue;
  const rev = [];
  let nome = txt(g(l, 'Produto'));
  if (!nome) { rev.push('sem nome'); nome = `SEM NOME (linha ${i + 1})`; }
  else if (/^\d{8,14}$/.test(nome)) rev.push('nome é um código de barras');

  const codDig = dig(g(l, 'Código')), codTxt = txt(g(l, 'Código'));
  const ceanDig = dig(g(l, 'Cean'));
  let ean = ehEan(codDig) && codDig === String(codTxt).replace(/\D/g, '') ? codDig : (ehEan(ceanDig) ? ceanDig : null);
  if (ean && eans.has(ean)) { rev.push(`código de barras ${ean} repetido na planilha`); ean = null; }
  if (ean) eans.add(ean);
  const codigo = ean && ean === codDig ? null : codTxt;

  const preco = num(g(l, 'Preço de venda'));
  if (preco == null || preco <= 0) rev.push('sem preço de venda (importado inativo)');
  const custo = num(g(l, 'Preço de custo'));
  const cm = corrigirCustoMedio(num(g(l, 'Custo médio')), custo);
  if (cm.corrigido) rev.push(cm.valor == null ? 'custo médio ilegível' : 'custo médio corrigido (vírgula)');

  let ncm = dig(g(l, 'NCM'));
  if (ncm.length === 7) ncm = '0' + ncm;
  if (ncm && ncm.length !== 8) { rev.push(`NCM inválido (${ncm})`); ncm = ''; }
  else if (!ncm) rev.push('sem NCM');
  const csosn = dig(g(l, 'Cst'));
  const cest = dig(g(l, 'Cest'));
  const gtinTrib = dig(g(l, 'Ceantrib'));
  const anp = dig(g(l, 'Cprodanp'));
  const { adulto, fumigeno } = pelaNcm(ncm);
  const qtd = num(g(l, 'Quantidade'));

  itens.push({
    linha: i + 1, nome: nome.slice(0, 200), codigo_barras: ean, codigo,
    sku: txt(g(l, 'Código interno')), setor: txt(g(l, 'Setor')),
    fabricante: txt(g(l, 'Fabricante')), fornecedor: txt(g(l, 'Fornecedor')),
    unidade_comercial: unidade(g(l, 'Unidade')),
    preco_varejo: preco != null && preco > 0 ? Math.round(preco * 100) / 100 : 0,
    preco_custo: custo, custo_medio: cm.valor,
    estoque_minimo: Math.max(0, num(g(l, 'Estoque mínimo')) ?? 0) || null,
    ultimo_reajuste: data(g(l, 'Último reajuste')),
    ncm: ncm || null, cest: cest.length === 7 ? cest : null,
    csosn: /^\d{3}$/.test(csosn) ? csosn : null,
    icms_aliquota: num(g(l, 'Icms')), icms_base: num(g(l, 'Basecalculo')), ipi_aliquota: num(g(l, 'Ipi')),
    cst_pis: /^\d{2}$/.test(dig(g(l, 'Cst_pis'))) ? dig(g(l, 'Cst_pis')) : null,
    cst_cofins: /^\d{2}$/.test(dig(g(l, 'Cst_cofins'))) ? dig(g(l, 'Cst_cofins')) : null,
    gtin_tributavel: ehEan(gtinTrib) ? gtinTrib : null,
    codigo_anp: anp.length === 9 ? anp : null,
    observacao: txt(g(l, 'Observações'))?.slice(0, 1000) ?? null,
    adulto, fumigeno, ativo: preco != null && preco > 0,
    qtd_planilha: qtd,
    revisar: rev.length ? rev.join('; ').slice(0, 300) : null,
  });
}

// ------------------------------------------------------------------ 4. prévia (CSV para o Excel)
const csvCampo = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const br = (n) => (n == null ? '' : String(n).replace('.', ','));
const colunas = ['linha', 'nome', 'codigo_barras', 'codigo', 'setor', 'fabricante', 'unidade_comercial', 'preco_varejo', 'preco_custo',
  'custo_medio', 'ncm', 'csosn', 'icms_aliquota', 'adulto', 'fumigeno', 'ativo', 'qtd_planilha', 'revisar'];
const numericas = new Set(['preco_varejo', 'preco_custo', 'custo_medio', 'icms_aliquota']);
const csv = [colunas.join(';'), ...itens.map((it) => colunas.map((c) => {
  const v = it[c];
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  return csvCampo(numericas.has(c) ? br(v) : (c === 'codigo_barras' && v ? `="${v}"` : v));
}).join(';'))].join('\r\n');
const saida = arquivo.replace(/\.xlsx$/i, '') + '-previa.csv';
fs.writeFileSync(saida, '\uFEFF' + csv, 'utf8');

const cont = (f) => itens.filter(f).length;
const motivos = {};
for (const it of itens) for (const m of (it.revisar ?? '').split('; ').filter(Boolean)) {
  const k = m.replace(/\d{8,14}/, 'X'); motivos[k] = (motivos[k] ?? 0) + 1;
}
console.log(`\nPlanilha: ${path.basename(arquivo)} · ${itens.length} produtos lidos`);
console.log(`  com código de barras: ${cont((i) => i.codigo_barras)} · só código antigo: ${cont((i) => !i.codigo_barras)}`);
console.log(`  +18 pelo NCM: ${cont((i) => i.adulto)} (fumígeno: ${cont((i) => i.fumigeno)}) · inativos (sem preço): ${cont((i) => !i.ativo)}`);
console.log(`  setores: ${[...new Set(itens.map((i) => i.setor).filter(Boolean))].join(', ') || '-'}`);
console.log(`  para revisar: ${cont((i) => i.revisar)}`);
for (const [m, n] of Object.entries(motivos).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)} · ${m}`);
console.log(`  estoque: NÃO importado (decisão D1: entra zerado; fazer inventário)`);
console.log(`Prévia salva em: ${saida}`);
if (DESATIVAR) console.log('Com --desativar-antigos: todo produto que NÃO vier desta planilha fica INATIVO (some do PDV; nada é apagado).');

if (!GRAVAR) {
  console.log('\nNada foi gravado. Confira a prévia e rode de novo com --gravar.');
  process.exit(0);
}

// ------------------------------------------------------------------ 5. gravar (service role; RLS deny-all só deixa o servidor)
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL, CHAVE = process.env.SUPABASE_SECRET_KEY;
if (!SB_URL || !CHAVE) { console.error('Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY no --env-file.'); process.exit(1); }
const { createClient } = await import('@supabase/supabase-js');
const db = createClient(SB_URL, CHAVE, { auth: { persistSession: false } });
const ref = new URL(SB_URL).hostname.split('.')[0];
console.log(`\nGRAVANDO no banco ${ref} ...`);

const { data: tenants, error: eT } = await db.from('tenants').select('id, nome').order('criado_em').limit(2);
if (eT) throw eT;
if (!tenants?.length) { console.error('Nenhuma empresa (tenant) no banco.'); process.exit(1); }
const tenant = tenants[0].id;

// categorias (setor da planilha)
const { data: cats } = await db.from('categorias').select('id, nome').eq('tenant_id', tenant);
const catId = new Map((cats ?? []).map((c) => [c.nome.toLowerCase(), c.id]));
for (const s of new Set(itens.map((i) => i.setor).filter(Boolean))) {
  if (catId.has(s.toLowerCase())) continue;
  const { data: nova, error } = await db.from('categorias').insert({ tenant_id: tenant, nome: s }).select('id').single();
  if (error) throw error;
  catId.set(s.toLowerCase(), nova.id);
}

// produtos já existentes (para atualizar em vez de duplicar)
const existentes = [];
for (let de = 0; ; de += 1000) {
  const { data: pg, error } = await db.from('produtos').select('id, codigo_barras, codigo, nome, origem_dados')
    .eq('tenant_id', tenant).range(de, de + 999);
  if (error) throw error;
  existentes.push(...pg);
  if (pg.length < 1000) break;
}
const porEan = new Map(existentes.filter((p) => p.codigo_barras).map((p) => [p.codigo_barras, p.id]));
const porCodNome = new Map(existentes.filter((p) => p.origem_dados).map((p) => [`${p.codigo ?? ''}|${p.nome.toLowerCase()}`, p.id]));

let desativados = 0;
if (DESATIVAR) {
  const { data: des, error } = await db.from('produtos').update({ ativo: false })
    .eq('tenant_id', tenant).eq('ativo', true).or(`origem_dados.is.null,origem_dados.neq."${ORIGEM}"`).select('id');
  if (error) throw error;
  desativados = des.length;
  console.log(`  catálogo antigo: ${desativados} produtos DESATIVADOS (nada apagado; os que estão na planilha voltam ativos)`);
}

let novos = 0, atualizados = 0, falhas = 0;
for (const it of itens) {
  const linha = {
    tenant_id: tenant, nome: it.nome, codigo_barras: it.codigo_barras, codigo: it.codigo, sku: it.sku,
    categoria_id: it.setor ? catId.get(it.setor.toLowerCase()) : null,
    fabricante: it.fabricante, fornecedor: it.fornecedor, unidade_comercial: it.unidade_comercial,
    preco_varejo: it.preco_varejo, preco_custo: it.preco_custo, custo_medio: it.custo_medio,
    estoque_minimo: it.estoque_minimo, ultimo_reajuste: it.ultimo_reajuste,
    ncm: it.ncm, cest: it.cest, csosn: it.csosn, icms_aliquota: it.icms_aliquota, icms_base: it.icms_base,
    ipi_aliquota: it.ipi_aliquota, cst_pis: it.cst_pis, cst_cofins: it.cst_cofins, gtin_tributavel: it.gtin_tributavel,
    codigo_anp: it.codigo_anp, observacao: it.observacao, adulto: it.adulto, fumigeno: it.fumigeno, ativo: it.ativo,
    origem_dados: ORIGEM, revisar: it.revisar,
  };
  const id = (it.codigo_barras && porEan.get(it.codigo_barras)) || porCodNome.get(`${it.codigo ?? ''}|${it.nome.toLowerCase()}`);
  const { error } = id
    ? await db.from('produtos').update(linha).eq('id', id).eq('tenant_id', tenant)
    : await db.from('produtos').insert({ ...linha, tipo: 'revenda', unidade: 'un' });
  if (error) { falhas++; console.log(`  FALHA linha ${it.linha} (${it.nome}): ${error.message}`); continue; }
  if (id) atualizados++; else novos++;
  if ((novos + atualizados) % 200 === 0) console.log(`  ... ${novos + atualizados} de ${itens.length}`);
}
console.log(`\nRESULTADO: ${novos} novos · ${atualizados} atualizados · ${desativados} antigos desativados · ${falhas} falhas · banco ${ref}`);
process.exit(falhas ? 2 : 0);
