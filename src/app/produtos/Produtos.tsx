'use client';
import { useEffect, useState } from 'react';
import { kpisProdutos, listarProdutosCatalogo, type FiltroProdutos, type KpisProdutos, type ProdutoLinha } from './actions';
import { CadastroRapidoProduto } from '@/components/CadastroRapidoProduto';
import { FichaProduto } from '@/components/FichaProduto';
import { Icone } from '@/components/Icone';
import { brl } from '@/lib/formatar';
import type { Papel } from '@/lib/papeis';

// Tela de produtos no padrão ERP (public/prototipos/vendas.html): título + 5 KPIs + busca/chips + tabela.
// "Novo produto" usa o MESMO cadastro do PDV (0007 produto_criar), com textos de cadastro independente.
type Aviso = { tipo: 'ok' | 'erro'; texto: string } | null;

export function Produtos({ papel, locais, deveTrocarSenha }: {
  papel: Papel; locais: { id: string; nome: string }[]; deveTrocarSenha: boolean;
}) {
  const [termo, setTermo] = useState('');
  const [filtro, setFiltro] = useState<FiltroProdutos>('ativos');
  const [lista, setLista] = useState<ProdutoLinha[] | null>(null);
  const [kpis, setKpis] = useState<KpisProdutos | null>(null);
  const [localId, setLocalId] = useState(locais[0]?.id ?? '');
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<ProdutoLinha | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [versao, setVersao] = useState(0);
  const podeEditar = papel === 'master' || papel === 'gerente' || papel === 'estoquista';
  const localNome = locais.find((l) => l.id === localId)?.nome ?? '';

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(async () => {
      const r = await listarProdutosCatalogo(termo, filtro);
      if (vivo) setLista(r);
    }, termo ? 200 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [termo, filtro, versao]);

  useEffect(() => { kpisProdutos().then(setKpis); }, [versao]);

  const cards: { id: string; nome: string; sub: string; icone: string; valor: number | undefined; alerta?: boolean }[] = [
    { id: 'ativos', nome: 'Produtos ativos', sub: 'à venda no PDV e no bar', icone: 'pacote', valor: kpis?.ativos },
    { id: 'novos', nome: 'Novos no mês', sub: 'cadastrados este mês', icone: 'mais', valor: kpis?.novosMes },
    { id: 'sem-estoque', nome: 'Sem estoque', sub: 'revenda com saldo zero', icone: 'alerta', valor: kpis?.semEstoque, alerta: true },
    { id: 'sem-codigo', nome: 'Sem código de barras', sub: 'o leitor não acha', icone: 'codigo', valor: kpis?.semCodigo, alerta: true },
    { id: 'adultos', nome: 'Itens +18', sub: 'pedem confirmação de idade', icone: 'cadeado', valor: kpis?.adultos },
  ];

  return (
    <div className="min-h-screen bg-fundo" data-testid="produtos">
      <div className="mx-auto w-full max-w-[1440px] space-y-4 px-4 py-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-[21px] font-extrabold leading-tight text-estrutura lg:text-[26px]">
            Produtos<span className="text-[14.5px] font-normal text-ink-soft"> - cadastro do catálogo, preço e código de barras</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {locais.length > 0 && (
              <label className="flex items-center gap-2">
                <span className="text-[11px] font-extrabold uppercase tracking-[.1em] text-ink-soft">Saldo inicial em</span>
                <select value={localId} onChange={(e) => setLocalId(e.target.value)} data-testid="produtos-local"
                  className="rounded-full border border-line bg-white px-4 py-2 text-[13.5px] font-bold text-estrutura shadow-card focus:border-estrutura focus:outline-none">
                  {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                </select>
              </label>
            )}
            <button type="button" onClick={() => { setNovo(true); setAviso(null); }} disabled={!localId || deveTrocarSenha}
              data-testid="produtos-novo"
              className="flex items-center gap-2 rounded-full bg-acao-600 px-5 py-2.5 text-[14px] font-extrabold text-white shadow-acao disabled:opacity-50">
              <Icone n="mais" className="h-4 w-4" />Novo produto
            </button>
          </div>
        </div>

        {deveTrocarSenha && (
          <p className="rounded-card border-l-4 border-warn bg-white p-3 text-sm"><strong>Troque sua senha</strong> antes de cadastrar produtos. <a href="/conta/senha" className="font-bold underline">Trocar agora</a></p>
        )}
        {!locais.length && (
          <p className="rounded-card border-l-4 border-warn bg-white p-3 text-sm">Seu usuário não tem local vinculado: peça ao master para vincular a loja, o bar ou o depósito.</p>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="produtos-kpis">
          {cards.map((c) => {
            const ruim = c.alerta && (c.valor ?? 0) > 0;
            return (
              <div key={c.id} data-testid={`produtos-kpi-${c.id}`} className="rounded-card border border-line bg-white p-3.5 shadow-card">
                <span className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold uppercase tracking-[.1em] text-ink-soft">{c.nome}</span>
                  <span className={ruim ? 'text-bad' : 'text-estrutura'}><Icone n={c.icone} /></span>
                </span>
                <span className={`mt-1 block text-2xl font-extrabold tabular-nums ${ruim ? 'text-bad' : 'text-estrutura'}`}>{c.valor ?? '…'}</span>
                <span className="block text-[12px] text-ink-soft">{c.sub}</span>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft"><Icone n="busca" className="h-4 w-4" /></span>
            <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar por nome ou código de barras"
              data-testid="produtos-busca" autoComplete="off"
              className="w-full rounded-full border border-line bg-white py-2.5 pl-11 pr-4 shadow-card focus:border-estrutura focus:outline-none" />
          </div>
          {([['ativos', 'Ativos'], ['sem_estoque', 'Sem estoque'], ['revisar', `Para revisar${kpis?.revisar ? ` (${kpis.revisar})` : ''}`], ['todos', 'Todos (inclui inativos)']] as [FiltroProdutos, string][]).map(([f, r]) => (
            <button key={f} type="button" onClick={() => setFiltro(f)} data-testid={`produtos-chip-${f}`}
              className={`whitespace-nowrap rounded-full border px-4 py-2 text-[13.5px] ${filtro === f
                ? 'border-estrutura bg-estrutura font-bold text-white'
                : 'border-line bg-white font-semibold text-ink-soft hover:border-estrutura hover:text-estrutura'}`}>{r}</button>
          ))}
        </div>

        {aviso && (
          <p data-testid="produtos-aviso" className={`rounded-card border-l-4 bg-white p-3 text-sm ${aviso.tipo === 'ok' ? 'border-ok' : 'border-bad'}`}>{aviso.texto}</p>
        )}

        <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
          <table className="w-full text-sm" data-testid="produtos-tabela">
            <thead className="bg-fundo/70 text-left text-[11px] font-extrabold uppercase tracking-[.1em] text-ink-soft">
              <tr>
                <th className="px-4 py-3">Produto</th>
                <th className="hidden px-4 py-3 md:table-cell">Código de barras</th>
                <th className="hidden px-4 py-3 lg:table-cell">Categoria</th>
                <th className="px-4 py-3 text-right">Preço</th>
                <th className="px-4 py-3 text-right">Saldo</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {lista === null && <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-soft">Carregando produtos…</td></tr>}
              {lista?.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-soft" data-testid="produtos-vazio">Nenhum produto encontrado.</td></tr>}
              {lista?.map((p) => (
                <tr key={p.id} className={`border-t border-line ${p.ativo ? '' : 'opacity-60'}`} data-testid="produtos-linha">
                  <td className="px-4 py-3">
                    <span className="font-bold text-estrutura">{p.nome}</span>
                    {p.adulto && <span className="ml-2 rounded-full bg-acao-100 px-2 py-0.5 text-[11px] font-bold text-acao-700">+18</span>}
                    {!p.ativo && <span className="ml-2 rounded-full bg-bad/10 px-2 py-0.5 text-[11px] font-bold text-bad">inativo</span>}
                    {p.revisar && <span title={p.revisar} className="ml-2 rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-bold text-estrutura">revisar</span>}
                  </td>
                  <td className="hidden px-4 py-3 tabular-nums md:table-cell">{p.codigo_barras ?? <span className="text-ink-soft">—</span>}</td>
                  <td className="hidden px-4 py-3 lg:table-cell">{p.categoria ?? <span className="text-ink-soft">Sem categoria</span>}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{brl(p.preco_varejo)}</td>
                  <td className={`px-4 py-3 text-right font-bold tabular-nums ${p.tipo === 'revenda' && p.saldo <= 0 ? 'text-bad' : ''}`}>
                    {p.saldo.toLocaleString('pt-BR')} {p.unidade}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {podeEditar && (
                      <button type="button" onClick={() => { setEditando(p); setAviso(null); }} data-testid="produtos-editar"
                        className="rounded-full bg-acao-600 px-3 py-1.5 text-xs font-bold text-white">Editar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lista?.length === 500 && (
            <p className="border-t border-line px-4 py-3 text-center text-[13px] text-ink-soft" data-testid="produtos-limite">
              Mostrando os 500 primeiros em ordem alfabética: use a busca para achar os outros.
            </p>
          )}
        </div>
      </div>

      {novo && (
        <CadastroRapidoProduto localId={localId} localNome={localNome}
          titulo="Novo produto" subtitulo="Cadastro do catálogo — já aparece no PDV e no bar assim que salvar."
          rotuloSubmit="Cadastrar produto"
          fechar={() => setNovo(false)}
          onCriado={(p) => { setAviso({ tipo: 'ok', texto: `${p.nome} cadastrado.` }); setVersao((v) => v + 1); }} />
      )}

      {editando && (
        <FichaProduto id={editando.id} total={kpis?.ativos} fechar={() => setEditando(null)}
          salvo={(nome) => { setEditando(null); setAviso({ tipo: 'ok', texto: `${nome} atualizado.` }); setVersao((v) => v + 1); }} />
      )}
    </div>
  );
}
