'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { carregarFicha, listarSetores, salvarFicha, type FichaProduto as Ficha } from '@/app/produtos/actions';
import { consultarGtin } from '@/app/produtos/gtin';
import { Icone } from '@/components/Icone';
import { brl } from '@/lib/formatar';

// Ficha completa do produto — layout novo (adega-sb-docs\novo layout\cadastro produtos001-003).
// Esquerda: dados gerais + financeiro e estoque. Direita: emissão fiscal (NF-e/NFC-e), reforma tributária
// (IBS/CBS) e abas Observações / Foto / Outros. Salva tudo pela 0010 produto_salvar_ficha (audit_log).
// Estoque NÃO se edita aqui (só inventário/entrada auditados).

const UNIDADES: [string, string][] = [
  ['UN', 'Unidade'], ['CX', 'Caixa'], ['PC', 'Peça'], ['PCT', 'Pacote'], ['FD', 'Fardo'], ['LT', 'Lata'],
  ['GF', 'Garrafa'], ['FR', 'Frasco'], ['DZ', 'Dúzia'], ['PR', 'Par'], ['KIT', 'Kit'],
  ['KG', 'Quilo'], ['GR', 'Grama'], ['L', 'Litro'], ['ML', 'Mililitro'],
];
const ORIGENS: [string, string][] = [
  ['0', '0 — Nacional'], ['1', '1 — Estrangeira, importação direta'], ['2', '2 — Estrangeira, mercado interno'],
  ['3', '3 — Nacional, conteúdo importado 40–70%'], ['4', '4 — Nacional, processo produtivo básico'],
  ['5', '5 — Nacional, conteúdo importado até 40%'], ['6', '6 — Estrangeira direta, sem similar (CAMEX)'],
  ['7', '7 — Estrangeira interna, sem similar (CAMEX)'], ['8', '8 — Nacional, conteúdo importado acima de 70%'],
];
const CSOSNS = ['101', '102', '103', '201', '202', '203', '300', '400', '500', '900'];

const CAMPO = 'mt-1 w-full rounded-lg border border-estrutura/40 bg-white px-3 py-2 text-[14px] text-estrutura focus:border-acao-600 focus:outline-none focus:ring-2 focus:ring-acao-100 disabled:bg-fundo disabled:text-ink-soft';
const LBL = 'block text-[12.5px] font-semibold text-estrutura';
const DICA = 'ml-1 text-[11px] font-normal text-ink-soft';
const SECAO = 'text-[11px] font-extrabold uppercase tracking-[.12em]';

// "R$ 1.234,56" / "47,00%" / "1234.56" → número (NaN se vazio/ruim)
const num = (v: string) => {
  const t = v.replace(/[^\d,.-]/g, '');
  if (!t) return NaN;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};
const fmt = (n: number, casas = 2) => (Number.isFinite(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas, useGrouping: false }) : '');
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const so = (v: string) => v.replace(/\D/g, '');

export function FichaProduto({ id, total, fechar, salvo }: {
  id: string; total?: number; fechar: () => void; salvo: (nome: string) => void;
}) {
  const [f, setF] = useState<Ficha | null>(null);
  const [orig, setOrig] = useState<Ficha | null>(null);
  const [margem, setMargem] = useState('');
  const [setores, setSetores] = useState<string[]>([]);
  const [aba, setAba] = useState<'obs' | 'foto' | 'outros'>('obs');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    let vivo = true;
    carregarFicha(id).then((d) => {
      if (!vivo) return;
      if (!d) { setErro('Produto não encontrado.'); return; }
      setF(d); setOrig(d); setMargem(calcMargem(d.preco_custo, d.preco_varejo));
    }).catch(() => setErro('Falha ao abrir o produto.'));
    listarSetores().then((s) => vivo && setSetores(s)).catch(() => {});
    return () => { vivo = false; };
  }, [id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fechar]);

  function calcMargem(custo: string, venda: string) {
    const c = num(custo), v = num(venda);
    return c > 0 && v > 0 ? fmt(((v - c) / v) * 100) + '%' : '';
  }
  const set = <K extends keyof Ficha>(k: K, v: Ficha[K]) => setF((x) => (x ? { ...x, [k]: v } : x));

  // financeiro: custo muda → recalcula margem; margem muda → recalcula preço; preço muda → margem + data de reajuste
  function mudarCusto(v: string) { if (!f) return; set('preco_custo', v); setMargem(calcMargem(v, f.preco_varejo)); }
  function mudarVenda(v: string) {
    if (!f) return;
    setF({ ...f, preco_varejo: v, ultimo_reajuste: orig && num(v) !== num(orig.preco_varejo) ? hoje() : orig?.ultimo_reajuste ?? f.ultimo_reajuste });
    setMargem(calcMargem(f.preco_custo, v));
  }
  function mudarMargem(v: string) {
    if (!f) return;
    setMargem(v);
    const m = num(v), c = num(f.preco_custo);
    if (c > 0 && m >= 0 && m < 100) {
      const venda = fmt(c / (1 - m / 100));
      setF({ ...f, preco_varejo: venda, ultimo_reajuste: orig && num(venda) !== num(orig.preco_varejo) ? hoje() : orig?.ultimo_reajuste ?? f.ultimo_reajuste });
    }
  }

  async function buscarGtin() {
    if (!f || buscando) return;
    setBuscando(true); setAviso(null);
    try {
      const d = await consultarGtin(f.codigo_barras);
      if (d.fonte === 'catalogo' && d.jaCadastrado && d.jaCadastrado !== f.nome) { setAviso(d.aviso ?? null); return; }
      if (d.fonte === 'catalogo') { setAviso('Este é o código deste mesmo produto.'); return; }
      const novo = { ...f };
      if (d.ncm && !f.ncm) novo.ncm = d.ncm;
      if (d.cest && !f.cest) novo.cest = d.cest;
      if (d.marca && !f.fabricante) novo.fabricante = d.marca;
      setF(novo);
      setAviso(d.nome ? `Encontrado (${d.fonte}): ${d.nome}. Preenchi só os campos vazios.` : d.aviso ?? 'Nada encontrado.');
    } catch { setAviso('Sem conexão com a consulta: preencha à mão.'); }
    finally { setBuscando(false); }
  }

  function validar(x: Ficha): string | null {
    if (!x.nome.trim()) return 'Informe a descrição do produto.';
    if (!(num(x.preco_varejo) >= 0)) return 'Preço de venda inválido (ex.: 12,50).';
    const ean = so(x.codigo_barras);
    if (ean && ![8, 12, 13, 14].includes(ean.length)) return 'Código de barras deve ter 8, 12, 13 ou 14 dígitos.';
    if (so(x.ncm) && so(x.ncm).length !== 8) return 'NCM deve ter 8 dígitos.';
    if (so(x.cest) && so(x.cest).length !== 7) return 'CEST deve ter 7 dígitos (ou deixe vazio).';
    if (so(x.csosn) && so(x.csosn).length !== 3) return 'CSOSN deve ter 3 dígitos.';
    if (so(x.cst_pis) && so(x.cst_pis).length !== 2) return 'CST PIS deve ter 2 dígitos.';
    if (so(x.cst_cofins) && so(x.cst_cofins).length !== 2) return 'CST Cofins deve ter 2 dígitos.';
    if (so(x.cst_ibs_cbs) && so(x.cst_ibs_cbs).length !== 3) return 'CST IBS/CBS deve ter 3 dígitos.';
    if (so(x.cclass_trib) && so(x.cclass_trib).length !== 6) return 'cClassTrib deve ter 6 dígitos.';
    if (x.fumigeno && !x.adulto) return 'Fumígeno exige +18.';
    return null;
  }

  async function salvar() {
    if (!f || pendente) return;
    const e = validar(f);
    if (e) { setErro(e); return; }
    setErro(null); setPendente(true);
    const n = (v: string) => { const x = num(v); return Number.isFinite(x) ? String(x) : ''; };
    try {
      const r = await salvarFicha(f.id, {
        nome: f.nome, codigo: f.codigo, sku: f.sku, codigo_barras: f.codigo_barras, categoria: f.categoria,
        fornecedor: f.fornecedor, fabricante: f.fabricante, unidade_comercial: f.unidade_comercial,
        preco_custo: n(f.preco_custo), preco_varejo: n(f.preco_varejo), estoque_minimo: n(f.estoque_minimo),
        ultimo_reajuste: f.ultimo_reajuste, oculto_tabela: f.oculto_tabela, ativo: f.ativo, adulto: f.adulto, fumigeno: f.fumigeno,
        ncm: f.ncm, csosn: f.csosn, cest: f.cest, origem: f.origem, icms_aliquota: n(f.icms_aliquota), icms_base: n(f.icms_base),
        ipi_aliquota: n(f.ipi_aliquota), cst_pis: f.cst_pis, cst_cofins: f.cst_cofins, peso_bruto: n(f.peso_bruto), peso_liquido: n(f.peso_liquido),
        cst_ibs_cbs: f.cst_ibs_cbs, cclass_trib: f.cclass_trib, observacao: f.observacao, gtin_tributavel: f.gtin_tributavel,
        previsao_chegada: f.previsao_chegada, codigo_anp: f.codigo_anp, fabricacao_propria: f.fabricacao_propria,
      });
      if (r.erro) { setErro(r.erro); return; }
      salvo(f.nome);
    } catch { setErro('Falha ao salvar o produto.'); }
    finally { setPendente(false); }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-fundo print:static" data-testid="ficha-produto">
      <div className="mx-auto w-full max-w-[1280px] p-3 lg:p-5">
        <div className="overflow-hidden rounded-card border border-line bg-white shadow-card">
          {/* barra do topo */}
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-fundo/60 px-4 py-3 print:hidden">
            <div className="mr-auto">
              <p className="text-[11px] font-extrabold uppercase tracking-[.12em] text-acao-700">ADEGA SB · catálogo</p>
              <h2 className="text-lg font-extrabold leading-tight text-estrutura">Cadastro de produto</h2>
            </div>
            {typeof total === 'number' && (
              <span className="rounded-full bg-estrutura px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white">{total.toLocaleString('pt-BR')} produtos</span>
            )}
            <button type="button" onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-[13px] font-bold text-estrutura hover:border-estrutura">Imprimir</button>
            <button type="button" onClick={fechar} data-testid="ficha-fechar" className="rounded-lg border border-line bg-white px-3 py-2 text-[13px] font-bold text-estrutura hover:border-estrutura">Voltar à lista</button>
            <button type="button" onClick={salvar} disabled={!f || pendente} data-testid="ficha-salvar"
              className="rounded-lg bg-acao-600 px-5 py-2 text-[13.5px] font-extrabold text-white shadow-acao disabled:opacity-50">{pendente ? 'Salvando…' : 'Salvar'}</button>
          </div>

          {!f && <p className="p-8 text-center text-ink-soft" data-testid="ficha-carregando">{erro ?? 'Abrindo produto…'}</p>}

          {f && (
            <div className="grid gap-0 lg:grid-cols-[1.25fr_1fr]">
              {/* ================= esquerda */}
              <div className="space-y-3 p-4 lg:border-r lg:border-line">
                {f.revisar && (
                  <p className="rounded-lg border-l-4 border-warn bg-warn/10 p-2.5 text-[13px] text-estrutura" data-testid="ficha-revisar">
                    <strong>Revisar (veio da planilha):</strong> {f.revisar}. Ao salvar, o aviso sai.
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-[1fr_2.2fr_1.2fr]">
                  <Campo f={f} set={set} k="codigo" rotulo="Código" />
                  <Campo f={f} set={set} k="nome" rotulo={<>Descrição do produto <span className="text-bad">*</span></>} />
                  <Campo f={f} set={set} k="sku" rotulo="Código interno" />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className={LBL}>Código de barras (GTIN)<span className={DICA}>busca pela lupa</span>
                    <span className="mt-1 flex gap-1.5">
                      <input value={f.codigo_barras} onChange={(e) => set('codigo_barras', e.target.value)} inputMode="numeric"
                        data-testid="ficha-codigo_barras" className={CAMPO.replace('mt-1 ', '')} />
                      <button type="button" onClick={buscarGtin} disabled={buscando || so(f.codigo_barras).length < 8}
                        className="rounded-lg border border-estrutura/40 px-2.5 text-[12px] font-bold text-estrutura disabled:opacity-40" title="Buscar dados pelo código">
                        {buscando ? '…' : <Icone n="busca" className="h-4 w-4" />}
                      </button>
                    </span>
                  </label>
                  <label className={LBL}>Setor<span className={DICA}>busca ou cadastra na hora</span>
                    <input value={f.categoria} onChange={(e) => set('categoria', e.target.value)} list="ficha-setores" data-testid="ficha-categoria" className={CAMPO} />
                    <datalist id="ficha-setores">{setores.map((s) => <option key={s} value={s} />)}</datalist>
                  </label>
                  <Campo f={f} set={set} k="fornecedor" rotulo="Fornecedor" dica="texto livre" />
                </div>
                {aviso && <p className="rounded-lg bg-fundo p-2 text-[12.5px] text-estrutura" data-testid="ficha-aviso">{aviso}</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo f={f} set={set} k="fabricante" rotulo="Fabricante" />
                  <label className={LBL}>Unidade
                    <select value={f.unidade_comercial} onChange={(e) => set('unidade_comercial', e.target.value)} className={CAMPO} data-testid="ficha-unidade_comercial">
                      {UNIDADES.map(([v, n]) => <option key={v} value={v}>{v} — {n}</option>)}
                    </select>
                  </label>
                </div>

                <p className={`${SECAO} pt-2 text-estrutura`}>Financeiro e estoque</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className={LBL}>Preço de custo
                    <input value={f.preco_custo} onChange={(e) => mudarCusto(e.target.value)} inputMode="decimal" placeholder="0,00" className={CAMPO} data-testid="ficha-preco_custo" />
                  </label>
                  <label className={LBL}>Margem de lucro<span className={DICA}>sobre a venda</span>
                    <input value={margem} onChange={(e) => mudarMargem(e.target.value)} inputMode="decimal" placeholder="—" className={CAMPO} data-testid="ficha-margem" />
                  </label>
                  <label className={LBL}>Preço de venda <span className="text-bad">*</span>
                    <input value={f.preco_varejo} onChange={(e) => mudarVenda(e.target.value)} inputMode="decimal" className={CAMPO} data-testid="ficha-preco_varejo" />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Campo f={f} set={set} k="estoque_minimo" rotulo="Qtd. mínima" inputMode="decimal" />
                  <label className={LBL}>Qtd. atual em estoque<span className={DICA}>só por inventário</span>
                    <input value={`${f.saldo.toLocaleString('pt-BR')} ${f.unidade}`} disabled className={CAMPO} data-testid="ficha-saldo" />
                  </label>
                  <label className={LBL}>Data último reajuste
                    <input type="date" value={f.ultimo_reajuste} onChange={(e) => set('ultimo_reajuste', e.target.value)} className={CAMPO} data-testid="ficha-ultimo_reajuste" />
                  </label>
                </div>
                {f.custo_medio !== null && (
                  <p className="text-[12px] text-ink-soft">Custo médio (das entradas): <strong className="text-estrutura">{brl(f.custo_medio)}</strong></p>
                )}
                <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1 text-[13.5px] text-estrutura">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={f.oculto_tabela} onChange={(e) => set('oculto_tabela', e.target.checked)} />Não imprimir na tabela de preços</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!f.ativo} onChange={(e) => set('ativo', !e.target.checked)} data-testid="ficha-inativo" />Inativo</label>
                  <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={f.adulto} onChange={(e) => set('adulto', e.target.checked)} data-testid="ficha-adulto" />+18</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={f.fumigeno} onChange={(e) => set('fumigeno', e.target.checked)} />Fumígeno</label>
                </div>
              </div>

              {/* ================= direita */}
              <div className="space-y-4 bg-fundo/40 p-4">
                <div className="space-y-3 rounded-lg border border-dashed border-acao-600/60 bg-acao-100/30 p-3.5">
                  <p className={`${SECAO} text-acao-700`}>Emissão de NF-e / NFC-e / CF-e</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Campo f={f} set={set} k="ncm" rotulo="NCM" inputMode="numeric" maxLength={10} />
                    <Campo f={f} set={set} k="csosn" rotulo="CSOSN" inputMode="numeric" maxLength={3} list="ficha-csosn" />
                    <datalist id="ficha-csosn">{CSOSNS.map((c) => <option key={c} value={c} />)}</datalist>
                    <Campo f={f} set={set} k="cest" rotulo="CEST" dica="opcional" inputMode="numeric" maxLength={9} placeholder="0000000" />
                    <label className={LBL}>Origem
                      <select value={f.origem} onChange={(e) => set('origem', e.target.value)} className={CAMPO} data-testid="ficha-origem">
                        {ORIGENS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                      </select>
                    </label>
                    <Campo f={f} set={set} k="icms_aliquota" rotulo="ICMS interno (%)" inputMode="decimal" />
                    <Campo f={f} set={set} k="icms_base" rotulo="Base de cálculo (%)" inputMode="decimal" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Campo f={f} set={set} k="ipi_aliquota" rotulo="IPI (%)" inputMode="decimal" />
                    <Campo f={f} set={set} k="cst_pis" rotulo="CST PIS" inputMode="numeric" maxLength={2} />
                    <Campo f={f} set={set} k="cst_cofins" rotulo="CST Cofins" inputMode="numeric" maxLength={2} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Campo f={f} set={set} k="peso_bruto" rotulo="Peso bruto (kg)" inputMode="decimal" />
                    <Campo f={f} set={set} k="peso_liquido" rotulo="Peso líquido (kg)" inputMode="decimal" />
                  </div>
                  <p className={`${SECAO} flex flex-wrap items-center gap-2 pt-1 text-acao-700`}>Reforma tributária (IBS/CBS)
                    <span className="rounded-full border border-line bg-white px-2 py-0.5 text-[10px] text-estrutura">novo · opcional em 2026</span></p>
                  <div className="grid grid-cols-2 gap-3">
                    <Campo f={f} set={set} k="cst_ibs_cbs" rotulo="CST IBS/CBS" dica="3 dígitos" inputMode="numeric" maxLength={3} placeholder="000" />
                    <Campo f={f} set={set} k="cclass_trib" rotulo="cClassTrib" dica="6 dígitos" inputMode="numeric" maxLength={6} placeholder="000000" />
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-line bg-white">
                  <div className="flex gap-1 border-b border-line bg-fundo/60 px-2 pt-2 text-[13px]">
                    {([['obs', '1. Observações'], ['foto', '2. Foto'], ['outros', '3. Outros']] as const).map(([a, r]) => (
                      <button key={a} type="button" onClick={() => setAba(a)} data-testid={`ficha-aba-${a}`}
                        className={`rounded-t-md px-3 py-1.5 ${aba === a ? 'border-b-2 border-acao-600 bg-white font-bold text-estrutura' : 'text-ink-soft'}`}>{r}</button>
                    ))}
                  </div>
                  <div className="p-3">
                    {aba === 'obs' && (
                      <textarea value={f.observacao} onChange={(e) => set('observacao', e.target.value)} rows={4} maxLength={1000}
                        data-testid="ficha-observacao" className={CAMPO.replace('mt-1 ', '')} placeholder="Anotações internas sobre o produto" />
                    )}
                    {aba === 'foto' && (
                      <div className="grid h-40 place-items-center rounded-lg border border-dashed border-line text-[13px] text-ink-soft">
                        Sem foto · envio de foto chega na próxima etapa
                      </div>
                    )}
                    {aba === 'outros' && (
                      <div className="space-y-3">
                        <Campo f={f} set={set} k="gtin_tributavel" rotulo="GTIN tributável" inputMode="numeric" />
                        <Campo f={f} set={set} k="previsao_chegada" rotulo="Previsão de chegada" type="date" />
                        <Campo f={f} set={set} k="codigo_anp" rotulo="Código ANP" dica="combustíveis" inputMode="numeric" />
                        <label className={LBL}>Origem do produto
                          <select value={f.fabricacao_propria ? 's' : 'n'} onChange={(e) => set('fabricacao_propria', e.target.value === 's')} className={CAMPO}>
                            <option value="n">Revenda (comprado de terceiros)</option>
                            <option value="s">Fabricação própria</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                </div>
                <p role="alert" className="min-h-5 text-sm font-bold text-bad" data-testid="ficha-erro">{erro}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// fora do componente principal: assim o input não é recriado a cada tecla (o foco não se perde)
type CampoProps = {
  f: Ficha; set: <K extends keyof Ficha>(k: K, v: Ficha[K]) => void;
  k: keyof Ficha; rotulo: ReactNode; dica?: string; cls?: string;
  inputMode?: 'numeric' | 'decimal' | 'text'; type?: string; maxLength?: number; placeholder?: string; list?: string;
};
function Campo({ f, set, k, rotulo, dica, cls = '', ...rest }: CampoProps) {
  return (
    <label className={`${LBL} ${cls}`}>{rotulo}{dica && <span className={DICA}>{dica}</span>}
      <input value={String(f[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} className={CAMPO} data-testid={`ficha-${k}`} {...rest} />
    </label>
  );
}
