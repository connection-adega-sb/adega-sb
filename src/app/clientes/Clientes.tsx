'use client';
import { useActionState, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  creditoCliente, definirAtivoCliente, definirLimiteCliente, historicoCliente, kpisClientes, listarClientes,
  pagamentosCliente, receberCredito,
  type ClienteResumo, type CompraCliente, type CreditoCliente, type KpisClientes, type PagamentoCredito,
} from './actions';
import { ClienteForm } from '@/components/ClienteForm';
import { Icone } from '@/components/Icone';
import { brl, cpf as fmtCpf, data as fmtData, dataHora, fone as fmtFone } from '@/lib/formatar';
import type { Papel } from '@/lib/papeis';

// Tela de clientes no padrão ERP (public/prototipos/vendas.html): título + 5 KPIs + busca/chips + tabela.
type Filtro = 'ativos' | 'todos';
type Aviso = { tipo: 'ok' | 'erro'; texto: string } | null;

const FORMA: Record<string, string> = { pix: 'PIX', cartao: 'Cartão', dinheiro: 'Dinheiro', boleto: 'Boleto', credito: 'Crédito' };

export function Clientes({ papel }: { papel: Papel }) {
  const [termo, setTermo] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('ativos');
  const [lista, setLista] = useState<ClienteResumo[] | null>(null);
  const [kpis, setKpis] = useState<KpisClientes | null>(null);
  const [editando, setEditando] = useState<ClienteResumo | 'novo' | null>(null);
  const [aberto, setAberto] = useState<ClienteResumo | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [versao, setVersao] = useState(0);
  const podeDesativar = papel === 'master' || papel === 'gerente';

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(async () => {
      const r = await listarClientes(termo, filtro === 'todos');
      if (vivo) setLista(r);
    }, termo ? 200 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [termo, filtro, versao]);

  useEffect(() => { kpisClientes().then(setKpis); }, [versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  async function alternarAtivo(c: ClienteResumo) {
    const r = await definirAtivoCliente(c.id, !c.ativo);
    setAviso(r.erro ? { tipo: 'erro', texto: r.erro } : { tipo: 'ok', texto: `${c.nome} ${c.ativo ? 'desativado' : 'reativado'}.` });
    setAberto(null); recarregar();
  }

  const cards: { id: string; nome: string; sub: string; icone: string; valor: string }[] = [
    { id: 'ativos', nome: 'Clientes ativos', sub: 'cadastro em uso', icone: 'usuario', valor: kpis ? String(kpis.ativos) : '…' },
    { id: 'novos', nome: 'Novos no mês', sub: 'cadastrados este mês', icone: 'mais', valor: kpis ? String(kpis.novosMes) : '…' },
    { id: 'compraram', nome: 'Compraram no mês', sub: 'identificados na venda', icone: 'carrinho', valor: kpis ? String(kpis.compraramMes) : '…' },
    { id: 'gasto', nome: 'Vendido a clientes', sub: 'no mês, com cliente', icone: 'dinheiro', valor: kpis ? brl(kpis.gastoMes) : '…' },
    { id: 'receber', nome: 'A receber (crédito)', sub: 'compras no crédito em aberto', icone: 'calculadora', valor: kpis ? brl(kpis.aReceber) : '…' },
  ];

  return (
    <div className="min-h-screen bg-fundo" data-testid="clientes">
      <div className="mx-auto w-full max-w-[1440px] space-y-4 px-4 py-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-[21px] font-extrabold leading-tight text-estrutura lg:text-[26px]">
            Clientes<span className="text-[14.5px] font-normal text-ink-soft"> - cadastro, contato e histórico de compras</span>
          </h1>
          <button type="button" onClick={() => { setEditando('novo'); setAviso(null); }} data-testid="clientes-novo"
            className="flex items-center gap-2 rounded-full bg-acao-600 px-5 py-2.5 text-[14px] font-extrabold text-white shadow-acao">
            <Icone n="mais" className="h-4 w-4" />Novo cliente
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="clientes-kpis">
          {cards.map((c) => (
            <div key={c.id} data-testid={`clientes-kpi-${c.id}`} className="rounded-card border border-line bg-white p-3.5 shadow-card">
              <span className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-[.1em] text-ink-soft">{c.nome}</span>
                <span className="text-estrutura"><Icone n={c.icone} /></span>
              </span>
              <span className="mt-1 block text-2xl font-extrabold tabular-nums text-estrutura">{c.valor}</span>
              <span className="block text-[12px] text-ink-soft">{c.sub}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft"><Icone n="busca" className="h-4 w-4" /></span>
            <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar por nome, telefone ou CPF"
              data-testid="clientes-busca" autoComplete="off"
              className="w-full rounded-full border border-line bg-white py-2.5 pl-11 pr-4 shadow-card focus:border-estrutura focus:outline-none" />
          </div>
          {(['ativos', 'todos'] as Filtro[]).map((f) => (
            <button key={f} type="button" onClick={() => setFiltro(f)} data-testid={`clientes-chip-${f}`}
              className={`whitespace-nowrap rounded-full border px-4 py-2 text-[13.5px] ${filtro === f
                ? 'border-estrutura bg-estrutura font-bold text-white'
                : 'border-line bg-white font-semibold text-ink-soft hover:border-estrutura hover:text-estrutura'}`}>
              {f === 'ativos' ? 'Ativos' : 'Todos (inclui desativados)'}
            </button>
          ))}
        </div>

        {aviso && (
          <p data-testid="clientes-aviso" className={`rounded-card border-l-4 bg-white p-3 text-sm ${aviso.tipo === 'ok' ? 'border-ok' : 'border-bad'}`}>{aviso.texto}</p>
        )}

        <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
          <table className="w-full text-sm" data-testid="clientes-tabela">
            <thead className="bg-fundo/70 text-left text-[11px] font-extrabold uppercase tracking-[.1em] text-ink-soft">
              <tr>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="hidden px-4 py-3 md:table-cell">CPF</th>
                <th className="px-4 py-3 text-right">Compras</th>
                <th className="hidden px-4 py-3 text-right sm:table-cell">Total gasto</th>
                <th className="px-4 py-3 text-right">Em aberto</th>
                <th className="hidden px-4 py-3 lg:table-cell">Última compra</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {lista === null && <tr><td colSpan={8} className="px-4 py-6 text-center text-ink-soft">Carregando clientes…</td></tr>}
              {lista?.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-ink-soft" data-testid="clientes-vazio">
                  {termo ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda. Clique em "Novo cliente".'}
                </td></tr>
              )}
              {lista?.map((c) => (
                <tr key={c.id} className={`border-t border-line ${c.ativo ? '' : 'opacity-60'}`} data-testid="clientes-linha">
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setAberto(c)} className="text-left font-bold text-estrutura hover:underline">{c.nome}</button>
                    {!c.ativo && <span className="ml-2 rounded-full bg-bad/10 px-2 py-0.5 text-[11px] font-bold text-bad">desativado</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{fmtFone(c.telefone) || <span className="text-ink-soft">—</span>}</td>
                  <td className="hidden px-4 py-3 tabular-nums md:table-cell">{fmtCpf(c.cpf) || <span className="text-ink-soft">—</span>}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.compras}</td>
                  <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">{brl(c.gasto)}</td>
                  <td className={`px-4 py-3 text-right font-bold tabular-nums ${c.emAberto > 0 ? 'text-bad' : 'text-ink-soft'}`} data-testid="clientes-em-aberto">{brl(c.emAberto)}</td>
                  <td className="hidden px-4 py-3 lg:table-cell">{c.ultimaCompra ? fmtData(c.ultimaCompra) : <span className="text-ink-soft">—</span>}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => { setEditando(c); setAviso(null); }} data-testid="clientes-editar"
                      className="rounded-full bg-acao-600 px-3 py-1.5 text-xs font-bold text-white">Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editando && (
        <Modal titulo={editando === 'novo' ? 'Novo cliente' : 'Editar cliente'} fechar={() => setEditando(null)}>
          <ClienteForm key={editando === 'novo' ? 'novo' : editando.id} inicial={editando === 'novo' ? null : editando}
            onSalvo={(c) => { setEditando(null); setAviso({ tipo: 'ok', texto: `${c.nome} salvo.` }); recarregar(); }}
            onCancelar={() => setEditando(null)} />
        </Modal>
      )}

      {aberto && (
        <Modal titulo={aberto.nome} fechar={() => setAberto(null)}>
          <Detalhe c={aberto} podeDesativar={podeDesativar} alternarAtivo={alternarAtivo}
            editar={() => { setEditando(aberto); setAberto(null); }} atualizado={recarregar} />
        </Modal>
      )}
    </div>
  );
}

function Modal({ titulo, fechar, children }: { titulo: string; fechar: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fechar]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-testid="clientes-modal">
      <div className="absolute inset-0 bg-estrutura/60" onClick={fechar} />
      <div className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-banner bg-white p-5 sm:rounded-banner">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-estrutura">{titulo}</h2>
          <button onClick={fechar} aria-label="Fechar" className="text-ink-soft"><Icone n="fechar" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Detalhe({ c, podeDesativar, alternarAtivo, editar, atualizado }: {
  c: ClienteResumo; podeDesativar: boolean; alternarAtivo: (c: ClienteResumo) => void; editar: () => void;
  atualizado: () => void;
}) {
  const [compras, setCompras] = useState<CompraCliente[] | null>(null);
  useEffect(() => { historicoCliente(c.id).then(setCompras); }, [c.id]);
  const zap = c.telefone ? `https://wa.me/55${c.telefone}` : null;
  return (
    <div className="space-y-4" data-testid="clientes-detalhe">
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-card bg-fundo p-2"><p className="text-xs text-ink-soft">Compras</p><p className="font-bold">{c.compras}</p></div>
        <div className="rounded-card bg-fundo p-2"><p className="text-xs text-ink-soft">Total gasto</p><p className="font-bold">{brl(c.gasto)}</p></div>
        <div className="rounded-card bg-fundo p-2"><p className="text-xs text-ink-soft">Ticket médio</p><p className="font-bold">{brl(c.compras ? c.gasto / c.compras : 0)}</p></div>
      </div>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-ink-soft">Telefone</dt><dd className="font-bold">{fmtFone(c.telefone) || '—'}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-ink-soft">CPF</dt><dd className="font-bold">{fmtCpf(c.cpf) || '—'}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-ink-soft">E-mail</dt><dd className="font-bold">{c.email || '—'}</dd></div>
        {c.observacao && <div className="rounded-card bg-acao-100 px-3 py-2 text-acao-700">{c.observacao}</div>}
        <div className="flex justify-between gap-3"><dt className="text-ink-soft">Cliente desde</dt><dd>{fmtData(c.criado_em)}</dd></div>
      </dl>

      <Credito clienteId={c.id} podeLimite={podeDesativar} atualizado={atualizado} />

      <div>
        <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[.1em] text-ink-soft">Últimas compras</p>
        {compras === null && <p className="text-sm text-ink-soft">Carregando…</p>}
        {compras?.length === 0 && <p className="text-sm text-ink-soft" data-testid="clientes-sem-compras">Nenhuma compra identificada ainda.</p>}
        <ul className="space-y-1" data-testid="clientes-compras">
          {compras?.map((v) => (
            <li key={v.id} className="flex justify-between rounded-card bg-fundo px-3 py-1.5 text-sm">
              <span className="text-ink-soft">{dataHora(v.criado_em)} · {FORMA[v.forma] ?? v.forma} · {v.itens} {v.itens === 1 ? 'item' : 'itens'}</span>
              <span className="font-bold tabular-nums">{brl(v.total)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={editar} className="rounded-full bg-acao-600 px-4 py-2 text-sm font-bold text-white">Editar</button>
        {zap && (
          <a href={zap} target="_blank" rel="noopener noreferrer"
            className="rounded-full border border-line px-4 py-2 text-sm font-bold text-estrutura hover:border-estrutura">WhatsApp</a>
        )}
        {podeDesativar && (
          <button type="button" onClick={() => alternarAtivo(c)} data-testid="clientes-ativo"
            className="rounded-full border border-line px-4 py-2 text-sm font-bold text-ink-soft hover:border-bad hover:text-bad">
            {c.ativo ? 'Desativar' : 'Reativar'}
          </button>
        )}
      </div>
    </div>
  );
}

// Crédito do cliente (0009): saldo em aberto, limite (master/gerente), receber pagamento e histórico.
function Credito({ clienteId, podeLimite, atualizado }: { clienteId: string; podeLimite: boolean; atualizado: () => void }) {
  const [cred, setCred] = useState<CreditoCliente | null>(null);
  const [pags, setPags] = useState<PagamentoCredito[]>([]);
  const [versao, setVersao] = useState(0);
  const [limiteTxt, setLimiteTxt] = useState('');
  const [erroLimite, setErroLimite] = useState<string | null>(null);
  const [st, acao, pend] = useActionState(receberCredito, {});

  useEffect(() => {
    creditoCliente(clienteId).then((r) => { setCred(r); setLimiteTxt(r.limite === null ? '' : r.limite.toFixed(2).replace('.', ',')); });
    pagamentosCliente(clienteId).then(setPags);
  }, [clienteId, versao]);
  useEffect(() => { if (st.ok) { setVersao((v) => v + 1); atualizado(); } }, [st, atualizado]);

  async function salvarLimite() {
    setErroLimite(null);
    const r = await definirLimiteCliente(clienteId, limiteTxt);
    if (r.erro) setErroLimite(r.erro); else setVersao((v) => v + 1);
  }

  return (
    <div className="space-y-3 rounded-card border border-line p-3" data-testid="clientes-credito">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-extrabold uppercase tracking-[.1em] text-ink-soft">Crédito (compra para pagar depois)</p>
        <p className={`text-lg font-extrabold tabular-nums ${cred && cred.saldo > 0 ? 'text-bad' : 'text-estrutura'}`} data-testid="clientes-credito-saldo">
          {cred ? brl(cred.saldo) : '…'}
        </p>
      </div>
      <p className="text-xs text-ink-soft">
        Limite: <strong>{cred?.limite == null ? 'sem limite' : brl(cred.limite)}</strong>
      </p>
      {podeLimite && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={limiteTxt} onChange={(e) => setLimiteTxt(e.target.value)} inputMode="decimal" placeholder="Limite (vazio = sem limite)"
            data-testid="clientes-limite" className="min-w-0 flex-1 rounded-full border border-line px-4 py-2 text-sm focus:border-estrutura focus:outline-none" />
          <button type="button" onClick={salvarLimite} data-testid="clientes-limite-salvar"
            className="rounded-full border border-estrutura px-4 py-2 text-sm font-bold text-estrutura">Salvar limite</button>
          {erroLimite && <p className="w-full text-sm font-bold text-bad">{erroLimite}</p>}
        </div>
      )}
      {cred && cred.saldo > 0 && (
        <form key={cred.saldo} action={acao} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]" data-testid="clientes-receber-form">
          <input type="hidden" name="clienteId" value={clienteId} />
          <input name="valor" inputMode="decimal" defaultValue={cred.saldo.toFixed(2).replace('.', ',')} data-testid="clientes-receber-valor"
            className="rounded-full border border-line px-4 py-2 text-sm focus:border-estrutura focus:outline-none" aria-label="Valor recebido" />
          <select name="forma" defaultValue="pix" data-testid="clientes-receber-forma"
            className="rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-estrutura focus:outline-none">
            <option value="pix">PIX</option><option value="cartao">Cartão</option><option value="dinheiro">Dinheiro (entra no caixa)</option>
          </select>
          <button disabled={pend} data-testid="clientes-receber"
            className="rounded-full bg-acao-600 px-4 py-2 text-sm font-extrabold text-white disabled:opacity-50">{pend ? 'Registrando…' : 'Receber'}</button>
          <p role="alert" className="text-sm font-bold text-bad sm:col-span-3">{st.erro}</p>
        </form>
      )}
      {pags.length > 0 && (
        <ul className="space-y-1" data-testid="clientes-pagamentos">
          {pags.map((p) => (
            <li key={p.id} className="flex justify-between rounded-card bg-ok/10 px-3 py-1.5 text-sm">
              <span className="text-ink-soft">{dataHora(p.criado_em)} · pagamento {FORMA[p.forma] ?? p.forma}</span>
              <span className="font-bold tabular-nums text-ok">− {brl(p.valor)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
