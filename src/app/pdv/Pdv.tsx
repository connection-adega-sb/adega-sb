'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useActionState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  buscarProdutos, sessaoAtual, ultimoTurno,
  abrirCaixa, lancarMovimento, fecharCaixa, finalizarVendaPdv,
  listarContas, abrirConta, adicionarNaConta, ajustarItemConta, type Conta,
  type ProdutoBusca, type CaixaInfo, type ResumoCaixa, type EstadoCaixa, type ResultadoFechamento,
} from './actions';
import { CadastroRapidoProduto } from '@/components/CadastroRapidoProduto';
import { ClienteSeletor } from '@/components/ClienteSeletor';
import { CpfNotaModal } from '@/components/CpfNotaModal';
import { PixQrModal } from '@/components/PixQrModal';
import { RelatorioFechamento } from '@/components/RelatorioFechamento';
import { ReciboVenda, type ReciboDados } from '@/components/ReciboVenda';
import { FecharContaModal, type PagamentoConta } from '@/components/FecharContaModal';
import { creditoCliente, type Cliente, type CreditoCliente } from '@/app/clientes/actions';
import { fone as fmtFone } from '@/lib/formatar';
import { PrecificacaoModal } from '@/components/PrecificacaoModal';
import { SiteLojaModal } from '@/components/SiteLojaModal';
import { VendasDiaModal } from '@/components/VendasDiaModal';
import { Icone } from '@/components/Icone';
import type { ProdutoNovo } from '@/app/produtos/actions';
import { type Papel } from '@/lib/papeis';

type Linha = { produto: ProdutoBusca; qtd: number };

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function Pdv({ caixas: caixasInicial, nome, papel, usuarioId, deveTrocarSenha }: {
  caixas: CaixaInfo[]; nome: string; papel: Papel; usuarioId: string; deveTrocarSenha: boolean;
}) {
  const [caixas] = useState<CaixaInfo[]>(caixasInicial);
  const [caixaId, setCaixaId] = useState<string>(caixasInicial[0]?.id ?? '');
  const [sessao, setSessao] = useState<ResumoCaixa | null>(null);
  const [turno, setTurno] = useState<ResumoCaixa | null>(null);
  const [carregando, setCarregando] = useState(true);

  // comanda
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [desconto, setDesconto] = useState(0);
  const [forma, setForma] = useState<'pix' | 'cartao' | 'dinheiro' | 'credito'>('pix');
  const [maior18, setMaior18] = useState(false);
  // cliente identificado (opcional — 0008); F4 abre o seletor
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [seletorCliente, setSeletorCliente] = useState(false);
  // F12 → "CPF na nota?" → venda → comprovante/recibo (fluxo do protótipo pdv.html, sem NFC-e até a F10)
  const [cpfModal, setCpfModal] = useState(false);
  const [recibo, setRecibo] = useState<ReciboDados | null>(null);
  // "Crédito" (0009): conta do cliente — saldo em aberto e limite aparecem na comanda
  const [credito, setCredito] = useState<CreditoCliente | null>(null);
  useEffect(() => {
    if (!cliente || forma !== 'credito') { setCredito(null); return; }
    let vivo = true;
    creditoCliente(cliente.id).then((r) => { if (vivo) setCredito(r); });
    return () => { vivo = false; };
  }, [cliente, forma]);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  // "Conta de cliente" (0011): consumo no local com o nome do cliente, como mesa de bar
  const [contas, setContas] = useState<Conta[]>([]);
  const [contaId, setContaId] = useState<string | null>(null);
  const [novaConta, setNovaConta] = useState<{ nome: string; maior18: boolean; cliente: Cliente | null } | null>(null);
  const [seletorConta, setSeletorConta] = useState(false);
  const [contaMaior18, setContaMaior18] = useState<Record<string, boolean>>({});
  const [fecharContaAberto, setFecharContaAberto] = useState(false);
  const [pixVenda, setPixVenda] = useState<{ cpf: string | null; txid: string } | null>(null);   // QR do PIX antes de gravar a venda

  // busca
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<ProdutoBusca[]>([]);
  const [destaque, setDestaque] = useState(0);
  const [buscando, setBuscando] = useState(false);

  // painel caixa
  const [painelAberto, setPainelAberto] = useState(false);
  const [abaCaixa, setAbaCaixa] = useState<'mov' | 'fechar'>('mov');
  const [drawer, setDrawer] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // cadastro de produto no meio da venda (produto novo que ainda não está no catálogo)
  const [cadastro, setCadastro] = useState<{ prefill?: { nome?: string; codigoBarras?: string } } | null>(null);

  // valor recebido em dinheiro (só informativo: calcula o troco na tela)
  const [recebido, setRecebido] = useState('');

  // módulos do topo do PDV — todos falam com o banco (nada de dado de protótipo)
  const [precoAberto, setPrecoAberto] = useState(false);
  const [siteAberto, setSiteAberto] = useState(false);
  const [vendasAberta, setVendasAberta] = useState(false);

  // layout: comanda inline no desktop, drawer no mobile (uma única instância no DOM)
  const [ehDesktop, setEhDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const h = () => setEhDesktop(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  const buscaRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(null);

  const aberto = !!sessao?.aberta;

  // ------------------------------------------------ carrega sessão do caixa escolhido
  const recarregar = useCallback(async (cid: string) => {
    if (!cid) { setSessao(null); setTurno(null); setCarregando(false); return; }
    const [ab, fe] = await Promise.all([sessaoAtual(cid), ultimoTurno(cid)]);
    setSessao(ab); setTurno(fe);
    setCarregando(false);
  }, []);

  useEffect(() => { setCarregando(true); recarregar(caixaId); }, [caixaId, recarregar]);
  // refresh usado pelo painel de caixa — estável (useCallback) para não gerar loop de efeito
  const aoAbrir = useCallback(() => { void recarregar(caixaId); }, [recarregar, caixaId]);

  const localAtual = caixas.find((c) => c.id === caixaId)?.local_id;

  // contas abertas do local (quadro abaixo da área do PDV)
  // contaSeq muda a cada mudança otimista: uma leitura do banco que começou ANTES dela chega velha e é ignorada
  // (senão o quadro "voltava" para o total antigo por um instante enquanto o leitor ainda gravava)
  const contaSeq = useRef(0);
  const jobsConta = useRef(new Set<Promise<unknown>>());
  const timersConta = useRef(new Map<string, { t: ReturnType<typeof setTimeout>; rodar: () => void }>());
  const recarregarContas = useCallback(async () => {
    if (!localAtual || !aberto) { setContas([]); return [] as Conta[]; }
    const seq = contaSeq.current;
    const r = await listarContas(localAtual);
    if (seq !== contaSeq.current || jobsConta.current.size || timersConta.current.size) return r;
    setContas(r);
    setContaId((id) => (id && r.some((c) => c.id === id) ? id : null));
    return r;
  }, [localAtual, aberto]);
  useEffect(() => { void recarregarContas(); }, [recarregarContas]);

  // Conta: a tela muda NA HORA (otimista) e o banco grava atrás. O −/+ espera 350 ms parado e manda só a
  // quantidade final; o quadro recarrega quando não sobra nada pendente. Fechar a conta espera tudo gravar.
  const otimista = useCallback((id: string, fn: (itens: Conta['itens']) => Conta['itens']) => {
    contaSeq.current += 1;
    setContas((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const itens = fn(c.itens);
      return { ...c, itens, total: Math.round(itens.reduce((t, i) => t + i.subtotal, 0) * 100) / 100 };
    }));
  }, []);
  const rodarConta = useCallback((job: () => Promise<{ erro?: string }>) => {
    const pr = job().then(async (r) => {
      if (r.erro) setAviso({ tipo: 'erro', texto: r.erro.includes('+18') ? 'Item +18: marque "maiores de 18 anos" na conta.' : r.erro });
      return r;
    }).finally(() => {
      jobsConta.current.delete(pr);
      if (!jobsConta.current.size && !timersConta.current.size) void recarregarContas();
    });
    jobsConta.current.add(pr);
    return pr;
  }, [recarregarContas]);
  const mudarQtdConta = useCallback((contaAlvo: string, item: Conta['itens'][number], nova: number) => {
    if (!sessao || item.id.startsWith('tmp-')) return;
    const qtd = Math.max(0, nova);
    otimista(contaAlvo, (itens) => itens.flatMap((i) => (i.id !== item.id ? [i]
      : qtd === 0 ? [] : [{ ...i, qtd, subtotal: Math.round(i.preco * qtd * 100) / 100 }])));
    const antes = timersConta.current.get(item.id);
    if (antes) clearTimeout(antes.t);
    const rodar = () => {
      timersConta.current.delete(item.id);
      void rodarConta(() => ajustarItemConta({ sessaoId: sessao.sessaoId, contaId: contaAlvo, itemId: item.id, qtd }));
    };
    timersConta.current.set(item.id, { t: setTimeout(rodar, 350), rodar });
  }, [sessao, otimista, rodarConta]);
  const gravarPendentesConta = useCallback(async () => {
    for (const [, v] of timersConta.current) { clearTimeout(v.t); v.rodar(); }
    while (jobsConta.current.size) await Promise.all([...jobsConta.current]);
  }, []);
  async function abrirFechamento() {
    if (!conta) return;
    await gravarPendentesConta();
    const lista = await recarregarContas();
    if (lista.find((c) => c.id === conta.id)?.itens.length) setFecharContaAberto(true);
  }
  const conta = contas.find((c) => c.id === contaId) ?? null;

  // ------------------------------------------------ busca com debounce (PDV-02)
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (termo.trim().length < 2) { setResultados([]); setDestaque(0); return; }
    setBuscando(true);
    debounce.current = setTimeout(async () => {
      const r = await buscarProdutos(termo, aberto ? localAtual : undefined);
      setResultados(r); setDestaque(0); setBuscando(false);
    }, 200);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [termo, aberto, localAtual]);

  // ------------------------------------------------ adicionar item (PDV-04/06/07)
  const adicionar = useCallback((p: ProdutoBusca, qtdExtra = 1) => {
    if (!aberto) return;
    if (contaId && sessao) {   // conta de cliente ativa: o item vai direto para a conta (gravado no banco)
      setTermo(''); setResultados([]); buscaRef.current?.focus();
      setAviso(null);
      // aparece na hora; o banco confirma atrás (item novo fica "tmp-" até o quadro recarregar)
      otimista(contaId, (itens) => {
        const i = itens.findIndex((x) => x.produtoId === p.id);
        if (i >= 0) return itens.map((x, k) => (k !== i ? x : { ...x, qtd: x.qtd + qtdExtra, subtotal: Math.round(x.preco * (x.qtd + qtdExtra) * 100) / 100 }));
        return [...itens, { id: `tmp-${p.id}-${Date.now()}`, produtoId: p.id, nome: p.nome, qtd: qtdExtra, preco: p.preco_varejo,
          subtotal: Math.round(p.preco_varejo * qtdExtra * 100) / 100, adulto: p.adulto }];
      });
      void rodarConta(() => adicionarNaConta({ sessaoId: sessao.sessaoId, contaId, produtoId: p.id, qtd: qtdExtra, maior18: !!contaMaior18[contaId] }));
      return;
    }
    if (p.estoque <= 0 && !p.fumigeno) { /* segue: estoque negativo é recusado no servidor */ }
    setLinhas((prev) => {
      const i = prev.findIndex((l) => l.produto.id === p.id);
      if (i >= 0) {
        const copia = [...prev];
        copia[i] = { ...copia[i], qtd: copia[i].qtd + qtdExtra };
        // destaca a linha do último lido (PDV-07): move para o fim
        const [lin] = copia.splice(i, 1);
        return [...copia, lin];
      }
      return [...prev, { produto: p, qtd: qtdExtra }];
    });
    setTermo(''); setResultados([]);
    buscaRef.current?.focus();
  }, [aberto, contaId, sessao, contaMaior18, otimista, rodarConta]);

  // cadastro feito no MEIO da venda → o produto entra na comanda na hora e a operação segue
  const aoCadastrar = useCallback((p: ProdutoNovo) => {
    if (aberto) {
      adicionar(p);
      setAviso({ tipo: 'ok', texto: `"${p.nome}" cadastrado e lançado na comanda.` });
    } else {
      setAviso({ tipo: 'ok', texto: `"${p.nome}" cadastrado no catálogo. Abra o caixa para vendê-lo.` });
    }
  }, [aberto, adicionar]);

  // parse multiplicador "3*7898107" ou "3x cerveja" (PDV-04)
  const parseMult = (t: string): { qtd: number; resto: string } => {
    const m = t.match(/^\s*(\d{1,3})\s*[*xX]\s*(.*)$/);
    if (m && Number(m[1]) >= 1) return { qtd: Number(m[1]), resto: m[2] };
    return { qtd: 1, resto: t };
  };

  const confirmarBusca = async () => {
    const { qtd, resto } = parseMult(termo);
    const t = resto.trim();
    if (t.length < 1) return;
    // código exato → entra direto (PDV-03, comportamento do leitor)
    const r = resultados.length && !/^\d{6,}$/.test(t) ? resultados : await buscarProdutos(t, aberto ? localAtual : undefined);
    const exato = r.find((p) => p.codigo_barras === t);
    const alvo = exato ?? r[destaque];
    if (alvo) adicionar(alvo, qtd);
  };

  // ------------------------------------------------ atalhos (§5.4)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // modal de cadastro aberto: ele segura o teclado (Esc fecha, nada mais dispara)
      if (cadastro) { if (e.key === 'Escape') { e.preventDefault(); setCadastro(null); } return; }
      // seletor de cliente aberto: ele segura o teclado (Esc fecha nele mesmo)
      if (seletorCliente || seletorConta) return;
      // conta de cliente: abrir (nome) e fechar (dividir) seguram o teclado
      if (novaConta || fecharContaAberto) return;
      // "CPF na nota?" e comprovante seguram o teclado (Enter/Esc tratados neles)
      if (cpfModal || recibo || pixVenda) return;
      // módulos do topo abertos: cada um fecha sozinho no Esc (senão o Esc limparia a busca)
      if (precoAberto || siteAberto || vendasAberta) return;
      if (e.key === 'F2') { e.preventDefault(); buscaRef.current?.focus(); }
      else if (e.key === 'F8') { e.preventDefault(); setPainelAberto(true); }
      else if (e.key === 'F9') { e.preventDefault(); setVendasAberta(true); }
      else if (e.key === 'F4') { e.preventDefault(); if (aberto) setSeletorCliente(true); }
      else if (e.key === 'F6') { e.preventDefault(); if (aberto && !outroOperador) setNovaConta({ nome: '', maior18: false, cliente: null }); }
      else if (e.key === 'F12') { e.preventDefault(); if (conta) { if (conta.itens.length) void abrirFechamento(); } else finalizar(); }
      else if (e.key === 'Escape') {
        if (painelAberto) setPainelAberto(false);
        else if (drawer) setDrawer(false);
        else { setTermo(''); setResultados([]); }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const alterarQtd = (id: string, delta: number) =>
    setLinhas((prev) => prev.flatMap((l) =>
      l.produto.id === id ? (l.qtd + delta < 1 ? [] : [{ ...l, qtd: l.qtd + delta }]) : [l]));

  const remover = (id: string) => setLinhas((prev) => prev.filter((l) => l.produto.id !== id));
  const limparItens = () => {
    setLinhas([]); setDesconto(0); setMaior18(false); setCliente(null);
    setForma((f) => (f === 'credito' ? 'pix' : f));   // crédito é por venda: a próxima volta ao PIX
  };
  const limpar = () => { limparItens(); setAviso(null); };

  // caixa aberto por OUTRA pessoa (§8: só quem abriu vende e fecha; master pode tudo) — avisa ANTES de montar a comanda
  const outroOperador = !!(aberto && sessao && sessao.operadorId !== usuarioId && papel !== 'master');

  const subtotal = linhas.reduce((s, l) => s + l.produto.preco_varejo * l.qtd, 0);
  const total = Math.max(0, subtotal - desconto);
  const temAdulto = linhas.some((l) => l.produto.adulto);

  // ------------------------------------------------ finalizar (FV-01..04)
  async function finalizar() {
    if (!aberto || !sessao || salvando) return;
    if (!linhas.length) { setAviso({ tipo: 'erro', texto: 'Comanda vazia.' }); return; }
    if (outroOperador) { setAviso({ tipo: 'erro', texto: `Este caixa está aberto por ${sessao.operador}: só quem abriu vende nele.` }); return; }
    if (temAdulto && !maior18) {
      setAviso({ tipo: 'erro', texto: 'Item +18: confirme que o cliente é maior de 18 anos.' });
      return;
    }
    if (forma === 'credito' && !cliente) {
      setAviso({ tipo: 'erro', texto: 'Crédito exige cliente: identifique o cliente (F4).' });
      setSeletorCliente(true);
      return;
    }
    setAviso(null);
    setCpfModal(true);   // última pergunta antes de gravar: "CPF na nota?"
  }

  // Depois do "CPF na nota?": pergunta se gera o QR PIX; a venda só grava na confirmação
  function confirmarVenda(cpf: string | null) {
    if (!aberto || !sessao || salvando) return;
    // toda forma (menos crédito/fiado) pergunta "gerar QR Code PIX?"; quem paga pelo QR vira venda PIX
    if (forma !== 'credito') { setCpfModal(false); setPixVenda({ cpf, txid: `PDV${Date.now().toString(36).toUpperCase()}` }); return; }
    void gravarVenda(cpf);
  }

  async function gravarVenda(cpf: string | null, formaUsada?: typeof forma) {
    if (!aberto || !sessao || salvando) return;
    const fp = formaUsada ?? forma;   // QR PIX gerado em outra forma → grava como PIX
    setSalvando(true); setAviso(null);
    const r = await finalizarVendaPdv({
      sessaoId: sessao.sessaoId,
      itens: linhas.map((l) => ({ produto_id: l.produto.id, quantidade: l.qtd })),
      desconto, forma: fp, maior18, clienteId: cliente?.id ?? null, cpf,
    });
    setSalvando(false);
    setCpfModal(false); setPixVenda(null);
    if (r.erro) { setAviso({ tipo: 'erro', texto: r.erro }); buscaRef.current?.focus(); return; }
    // foto da venda para o comprovante ANTES de zerar a comanda
    const dados: ReciboDados = {
      vendaId: r.vendaId ?? '', quando: r.quando ?? new Date().toISOString(),
      operador: sessao.operador || nome, caixa: nomeCaixa,
      itens: linhas.map((l) => ({ nome: l.produto.nome, qtd: l.qtd, preco: l.produto.preco_varejo })),
      subtotal, desconto, total, forma: fp,
      recebido: fp === 'dinheiro' && recebido !== '' ? Number(recebido) : null,
      cliente: cliente?.nome ?? null, cpf: cpf ?? cliente?.cpf ?? null, maior18: temAdulto && maior18,
    };
    // zera a comanda SEM apagar o aviso de sucesso (FV-04) — ordem importava
    const quem = cliente ? ` · ${cliente.nome}` : '';
    limparItens();
    setRecebido('');
    const rotuloForma = { pix: 'PIX', cartao: 'CARTÃO', dinheiro: 'DINHEIRO', credito: 'CRÉDITO' }[fp];
    setAviso({ tipo: 'ok', texto: `Venda finalizada: ${brl(total)} no ${rotuloForma}${quem}` });
    setRecibo(dados);
    await recarregar(caixaId);
  }

  // ------------------------------------------------ conta de cliente (0011)
  async function criarConta() {
    if (!novaConta || !sessao || salvando) return;
    setSalvando(true);
    const r = await abrirConta({ sessaoId: sessao.sessaoId, nome: novaConta.nome, clienteId: novaConta.cliente?.id ?? null });
    setSalvando(false);
    if (r.erro || !r.contaId) { setAviso({ tipo: 'erro', texto: r.erro ?? 'Não foi possível abrir a conta.' }); return; }
    setContaMaior18((m) => ({ ...m, [r.contaId as string]: novaConta.maior18 }));
    setNovaConta(null);
    await recarregarContas();
    setContaId(r.contaId);
    setAviso({ tipo: 'ok', texto: `Conta "${novaConta.nome.trim()}" aberta: passe os produtos.` });
    buscaRef.current?.focus();
  }

  async function aoPagarConta(p: PagamentoConta) {
    if (!conta || !sessao) return;
    setRecibo({
      vendaId: p.vendaId, quando: p.quando, operador: sessao.operador || nome, caixa: nomeCaixa,
      itens: p.itens, subtotal: p.total, desconto: 0, total: p.total, forma: p.forma, recebido: null,
      cliente: conta.nome, cpf: p.cpf, maior18: !!contaMaior18[conta.id],
    });
    const lista = await recarregarContas();
    if (!lista.some((c) => c.id === conta.id)) {
      setFecharContaAberto(false); setContaId(null);
      setAviso({ tipo: 'ok', texto: `Conta "${conta.nome}" fechada e paga.` });
    }
    await recarregar(caixaId);
  }

  // ------------------------------------------------ leitura do layout (mesmos dados do protótipo)
  const hoje = new Date().toLocaleDateString('pt-BR');
  const nomeCaixa = caixas.find((c) => c.id === caixaId)?.nome ?? '';
  const mult = parseMult(termo).qtd;

  if (deveTrocarSenha) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="rounded-card border-l-4 border-warn bg-white p-4 text-sm">
          <strong>Troque sua senha</strong> antes de usar o PDV.
        </p>
        <Link href="/conta/senha" data-testid="pdv-trocar-senha"
          className="mt-4 inline-block rounded-full bg-acao-600 px-5 py-3 font-bold text-white">Trocar senha agora</Link>
      </main>
    );
  }

  if (carregando) return <main className="p-8 text-center text-ink-soft">Carregando PDV…</main>;
  if (!caixas.length) return <main className="p-8 text-center text-ink-soft">Nenhum caixa cadastrado para seus locais.</main>;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-fundo" data-testid="pdv">
      {/* ------------------------------------------------ topo (mesmo desenho do protótipo) */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-estrutura px-4 py-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/brand/logo-colour.png" alt="ADEGA SB" width={116} height={48} priority className="h-10 w-auto shrink-0" />
          <div className="min-w-0">
            <p className="sr-only">ADEGA SB</p>
            <p className="flex items-center gap-2 truncate text-[10.5px] font-extrabold uppercase tracking-[.1em] text-white/70"
              data-testid="pdv-status">
              <span className={`h-2 w-2 shrink-0 rounded-full ${aberto ? 'bg-ok' : 'bg-white/40'}`} aria-hidden="true" />
              PDV · {nomeCaixa || 'caixa'} {aberto ? 'ABERTO' : 'FECHADO'} · {hoje}
            </p>
            <label className="mt-1 flex items-center gap-2">
              <span className="sr-only">Caixa</span>
              <select value={caixaId} onChange={(e) => setCaixaId(e.target.value)}
                data-testid="pdv-caixa-select"
                className="max-w-[14rem] rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-white focus:outline-none">
                {caixas.map((c) => <option key={c.id} value={c.id} className="text-ink">{c.nome}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <button type="button" onClick={() => setPrecoAberto(true)} aria-label="Precificação: ficha técnica e fracionamento"
            data-testid="pdv-precificacao"
            className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-2.5 text-[13px] font-bold text-white hover:bg-white/20 sm:px-4">
            <Icone n="calculadora" /><span className="hidden xl:inline">Precificação</span>
          </button>
          <button type="button" onClick={() => setSiteAberto(true)} aria-label="Abrir o site da loja (visão do cliente)"
            data-testid="pdv-site"
            className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-2.5 text-[13px] font-bold text-white hover:bg-white/20 sm:px-4">
            <Icone n="globo" /><span className="hidden sm:inline">Site da loja</span>
          </button>
          <button type="button" onClick={() => setVendasAberta(true)} aria-label="Vendas do dia e entregas"
            data-testid="pdv-vendas-dia"
            className="relative flex items-center gap-2 rounded-full bg-white/10 px-3 py-2.5 text-[13px] font-bold text-white hover:bg-white/20 sm:px-4">
            <Icone n="caminhao" />
            <span className="hidden sm:inline">Vendas e entregas<span className="hidden lg:inline font-semibold opacity-70"> (F9)</span></span>
          </button>
          <span className="hidden items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[13.5px] sm:flex"
            data-testid="pdv-operador">
            <Icone n="usuario" className="h-4 w-4 text-white/80" />
            <span className="hidden md:inline">Operador:</span> <strong>{nome}</strong>
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ------------------------------------------------ título + busca + catálogo */}
        <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4 lg:p-6">
          <h1 className="text-[21px] font-extrabold leading-tight text-estrutura lg:text-[26px]">
            Ponto de venda
            <span className="text-[14.5px] font-normal text-ink-soft"> - passe o leitor ou digite o produto</span>
          </h1>

          {outroOperador && sessao && (
            <p role="alert" data-testid="pdv-outro-operador" className="rounded-card border-l-4 border-bad bg-white p-3 text-sm">
              <strong>{nomeCaixa} está aberto por {sessao.operador}.</strong> Só quem abriu vende e fecha este caixa.
              Peça para {sessao.operador} fechar (F8 → Fechar caixa){caixas.length > 1 ? ' ou escolha outro caixa no topo' : ''}.
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft"><Icone n="busca" /></span>
              <label htmlFor="pdv-busca" className="sr-only">Buscar produto</label>
              <input
                id="pdv-busca"
                ref={buscaRef} value={termo} data-testid="pdv-busca" autoComplete="off" autoFocus
                onChange={(e) => setTermo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); confirmarBusca(); }
                  else if (e.key === 'ArrowDown') { e.preventDefault(); setDestaque((d) => Math.min(d + 1, resultados.length - 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setDestaque((d) => Math.max(d - 1, 0)); }
                }}
                disabled={!aberto}
                placeholder={aberto ? 'Nome ou código de barras (Enter adiciona)' : 'Abra o caixa para vender'}
                className="w-full rounded-full border-[1.5px] border-line-input bg-white py-3 pl-12 pr-14 text-sm text-ink shadow-card focus:border-estrutura focus:outline-none disabled:bg-fundo disabled:text-ink-soft"
              />
              {mult > 1 && (
                <span className="absolute right-11 top-1/2 -translate-y-1/2 rounded-full bg-acao-600 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">{mult}×</span>
              )}
              {termo && (
                <button type="button" aria-label="Limpar busca"
                  onClick={() => { setTermo(''); setResultados([]); buscaRef.current?.focus(); }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-soft hover:text-estrutura">
                  <Icone n="fechar" className="h-4 w-4" />
                </button>
              )}
            </div>

            <span className="hidden shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-white px-4 py-3 text-[13px] text-ink-soft shadow-card sm:flex">
              <span className="text-estrutura"><Icone n="codigo" /></span>
              <span>Leitor ativo · <kbd className="font-bold text-estrutura">F2</kbd></span>
            </span>

            <button
              type="button"
              onClick={() => setCadastro({})}
              disabled={!localAtual}
              data-testid="pdv-novo-produto"
              className="shrink-0 rounded-full border-[1.5px] border-acao-600 px-4 py-3 text-xs font-bold text-acao-600 transition-colors hover:bg-acao-100 disabled:opacity-50"
            >
              + Produto novo
            </button>

            <button
              type="button"
              onClick={() => setNovaConta({ nome: '', maior18: false, cliente: null })}
              disabled={!aberto || outroOperador}
              data-testid="pdv-conta-btn"
              title="Consumo no local com o nome do cliente (como mesa de bar)"
              className="shrink-0 rounded-full bg-acao-600 px-4 py-3 text-xs font-bold text-white shadow-acao transition-colors hover:opacity-90 disabled:opacity-50"
            >
              Conta de cliente<span className="hidden xl:inline font-semibold opacity-80"> · F6</span>
            </button>
          </div>

          {buscando && <p className="text-xs text-ink-soft" data-testid="pdv-buscando">Buscando…</p>}

          {/* painel de resultados: ocupa a altura que sobra, como no protótipo */}
          <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-white shadow-card ${aberto ? '' : 'mb-24 lg:mb-0'}`}>
            <div className={`shrink-0 grid-cols-[96px_1fr_84px_104px] items-center gap-3 border-b border-line bg-fundo/40 px-4 py-2.5 ${resultados.length ? 'hidden sm:grid' : 'hidden'}`}>
              <span className="label">Código</span>
              <span className="label">Produto</span>
              <span className="label text-right">Estoque</span>
              <span className="label text-right">Preço</span>
            </div>

            <ul className="min-h-0 flex-1 divide-y divide-fundo overflow-y-auto">
              {resultados.map((p, i) => {
                const naComanda = linhas.some((l) => l.produto.id === p.id);
                const qtdComanda = linhas.find((l) => l.produto.id === p.id)?.qtd ?? 0;
                const baixo = p.estoque <= 5;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => adicionar(p)}
                      data-testid={`pdv-res-${i}`}
                      className={`grid w-full grid-cols-[1fr_auto_36px] items-center gap-3 border-l-[3px] px-4 py-2.5 text-left sm:grid-cols-[96px_1fr_84px_104px_40px] ${i === destaque ? 'border-acao-600 bg-acao-100' : 'border-transparent hover:bg-fundo'}`}
                    >
                      <span className="hidden text-xs tabular-nums text-ink-soft sm:block">{p.codigo_barras}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">{p.nome}</span>
                        <span className="block truncate text-[11.5px] text-ink-soft">
                          <span className="tabular-nums sm:hidden">#{p.codigo_barras} · </span>
                          {p.adulto && <span className="font-semibold text-estrutura">+18 · </span>}
                          <span className={baixo ? 'font-semibold text-warn' : ''}>
                            {p.estoque} un.{baixo ? ' (baixo)' : ''}
                          </span>
                        </span>
                      </span>
                      <span className={`hidden text-right text-[13px] tabular-nums sm:block ${baixo ? 'font-bold text-warn' : 'text-ink-soft'}`}>
                        {p.estoque}{baixo && <span className="block text-[10.5px] font-semibold">baixo</span>}
                      </span>
                      <span className="text-right font-display text-[15px] font-bold tabular-nums text-estrutura">{brl(p.preco_varejo)}</span>
                      <span className={`flex min-w-8 items-center justify-center self-center rounded-full px-1.5 py-1 text-xs font-bold tabular-nums ${naComanda
                        ? 'bg-acao-600 text-white'
                        : 'bg-acao-100 text-acao-700 group-hover:bg-acao-600 group-hover:text-white'}`}>
                        {naComanda ? qtdComanda : <Icone n="mais" className="h-4 w-4" />}
                      </span>
                    </button>
                  </li>
                );
              })}

              {aberto && termo.trim().length >= 2 && !buscando && resultados.length === 0 && (
                <li className="flex h-full flex-col items-center justify-center p-10 text-ink-soft sm:p-12">
                  <Icone n="pacote" className="mb-3 h-12 w-12 text-ink-faint" />
                  <p className="text-sm font-semibold">Nenhum produto encontrado</p>
                  <p className="mt-1 text-xs">Confira o nome ou o código de barras.</p>
                  <div
                    className="mt-4 flex flex-wrap items-center justify-center gap-2 rounded-card border border-dashed border-line-input bg-fundo px-3 py-2 text-sm"
                    data-testid="pdv-nao-achou"
                  >
                    <span className="text-ink-soft">Nenhum produto com <strong>{termo.trim()}</strong> no catálogo.</span>
                    <button
                      type="button"
                      data-testid="pdv-cadastrar-achado"
                      onClick={() => {
                        const t = termo.trim();
                        setCadastro(/^\d{6,}$/.test(t)
                          ? { prefill: { codigoBarras: t } }
                          : { prefill: { nome: t } });
                      }}
                      className="rounded-full bg-acao-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:opacity-90"
                    >
                      Cadastrar este produto
                    </button>
                  </div>
                </li>
              )}

              {!termo && (
                <li className="flex h-full flex-col items-center justify-center p-8 text-center text-ink-soft sm:p-10" data-testid="pdv-vazio">
                  <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-acao-100 text-acao-700">
                    <Icone n={aberto ? 'codigo' : 'cadeado'} className="h-8 w-8" />
                  </span>
                  <p className="text-lg font-extrabold text-estrutura">{aberto ? 'Pronto para vender' : 'Caixa fechado'}</p>
                  <p className="mt-1 max-w-xs text-sm">
                    {aberto ? 'Passe o leitor ou digite parte do nome. Os produtos aparecem aqui.' : 'Abra o caixa com o seu operador para começar.'}
                  </p>
                  {!aberto && (
                    <button type="button" onClick={() => setPainelAberto(true)} data-testid="pdv-abrir-caixa-btn"
                      className="mt-4 flex items-center gap-2 rounded-full bg-acao-600 px-5 py-2.5 font-bold text-white shadow-acao">
                      <Icone n="desbloqueado" className="h-4 w-4" />Abrir caixa
                    </button>
                  )}
                  {aberto && (
                    <p className="mt-3 text-xs">
                      <kbd className="font-bold text-estrutura">↑↓</kbd> navega · <kbd className="font-bold text-estrutura">Enter</kbd> adiciona · <kbd className="font-bold text-estrutura">3*</kbd> antes do termo adiciona 3 unidades
                    </p>
                  )}
                </li>
              )}
            </ul>

            {resultados.length > 0 && (
              <div className="shrink-0 border-t border-line px-4 py-2 text-xs tabular-nums text-ink-soft" data-testid="pdv-resultados">
                {resultados.length} {resultados.length === 1 ? 'produto encontrado' : 'produtos encontrados'}
              </div>
            )}
          </div>

          {/* contas de cliente abertas: sempre à vista, logo abaixo da área do PDV */}
          {aberto && (
            <section className="mb-24 shrink-0 rounded-card border-[1.5px] border-dashed border-acao-600 bg-white p-3 shadow-card lg:mb-0" data-testid="pdv-contas">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold text-estrutura">
                  Contas abertas ({contas.length}) <span className="font-semibold text-ink-soft">· consumo no local</span>
                </h2>
                {contas.length > 0 && (
                  <span className="text-xs text-ink-soft tabular-nums">em aberto {brl(contas.reduce((a, c) => a + c.total, 0))}</span>
                )}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {contas.map((c, i) => (
                  <button key={c.id} type="button" data-testid={`pdv-conta-card-${i}`}
                    onClick={() => { setContaId(c.id === contaId ? null : c.id); setAviso(null); buscaRef.current?.focus(); }}
                    className={`min-w-[170px] max-w-[220px] shrink-0 rounded-card border px-3 py-2 text-left ${c.id === contaId ? 'border-2 border-acao-600 bg-acao-100' : 'border-line hover:border-estrutura'}`}>
                    <span className="block truncate text-sm font-extrabold text-estrutura">{c.nome}</span>
                    <span className="block truncate text-[11.5px] text-ink-soft">
                      {c.itens.length ? c.itens.map((it) => `${it.qtd.toLocaleString('pt-BR')} ${it.nome}`).join(' · ') : 'sem itens'}
                    </span>
                    <span className="block font-extrabold tabular-nums text-acao-700">{brl(c.total)}</span>
                    <span className="block text-[11px] text-ink-soft">aberta {new Date(c.abertaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                  </button>
                ))}
                <button type="button" onClick={() => setNovaConta({ nome: '', maior18: false, cliente: null })} disabled={outroOperador}
                  data-testid="pdv-conta-nova"
                  className="min-w-[140px] shrink-0 rounded-card border border-dashed border-line-input px-3 py-2 text-sm font-extrabold text-acao-700 hover:border-acao-600 disabled:opacity-50">
                  + Nova conta
                </button>
              </div>
            </section>
          )}
        </main>

        {/* ------------------------------------------------ comanda: instância única;
            desktop = coluna inline, mobile = drawer (mesmo nó, posição muda) */}
        <aside
          data-testid="pdv-comanda-area"
          aria-label="Comanda"
          className={
            ehDesktop
              ? 'flex w-full shrink-0 flex-col border-l border-line bg-white lg:w-[360px] xl:w-[420px]'
              : drawer
                ? 'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-white sm:w-[420px]'
                : 'hidden'
          }
        >
          {conta && sessao && (
            <div className="flex min-h-0 flex-1 flex-col" data-testid="pdv-conta-ativa">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-4">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 truncate text-lg font-extrabold text-estrutura">
                    <Icone n="usuario" className="h-5 w-5 shrink-0" /><span className="truncate" data-testid="pdv-conta-nome-ativa">Conta: {conta.nome}</span>
                  </h2>
                  <p className="text-xs text-ink-soft">Itens passados no leitor entram NESTA conta</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-acao-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-acao-700">
                    {conta.itens.reduce((a, i) => a + i.qtd, 0).toLocaleString('pt-BR')} itens
                  </span>
                  {!ehDesktop && drawer && (
                    <button onClick={() => setDrawer(false)} aria-label="Fechar" className="p-1 text-ink-soft hover:text-estrutura">
                      <Icone n="fechar" className="h-6 w-6" />
                    </button>
                  )}
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4" data-testid="pdv-conta-itens">
                {conta.itens.map((it) => (
                  <div key={it.id} className="flex items-center gap-2 rounded-card border border-line bg-white px-3 py-3" data-testid={`pdv-conta-linha-${it.produtoId}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{it.nome}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-ink-soft">{brl(it.preco)} × {it.qtd.toLocaleString('pt-BR')} = <strong className="text-estrutura">{brl(it.subtotal)}</strong></p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 rounded-full border border-line p-0.5">
                      <button aria-label="Diminuir" onClick={() => mudarQtdConta(conta.id, it, Math.ceil(it.qtd) - 1)} disabled={it.id.startsWith('tmp-')}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-fundo hover:text-estrutura"><Icone n="menos" className="h-3.5 w-3.5" /></button>
                      <span className="w-7 text-center text-xs font-bold tabular-nums text-estrutura">{it.qtd.toLocaleString('pt-BR')}</span>
                      <button aria-label="Aumentar" onClick={() => mudarQtdConta(conta.id, it, Math.floor(it.qtd) + 1)} disabled={it.id.startsWith('tmp-')}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-fundo hover:text-estrutura"><Icone n="mais" className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
                {!conta.itens.length && (
                  <div className="flex h-full flex-col items-center justify-center p-8 text-center text-ink-soft">
                    <Icone n="carrinho" className="mb-3 h-12 w-12 text-ink-faint" />
                    <p className="text-sm font-semibold">Conta vazia</p>
                    <p className="mt-1 text-xs">Passe o leitor ou busque o produto: ele entra nesta conta.</p>
                  </div>
                )}
              </div>
              {aviso && (
                <p role="alert" data-testid="pdv-conta-aviso"
                  className={`shrink-0 px-4 py-3 text-sm font-bold ${aviso.tipo === 'ok' ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'}`}>{aviso.texto}</p>
              )}
              <div className="shrink-0 space-y-3 border-t border-line bg-fundo/40 p-4">
                <label className="flex items-center gap-2 rounded-card bg-acao-100 px-3 py-2 text-sm font-bold text-acao-700" data-testid="pdv-conta-maior18-ativa">
                  <input type="checkbox" checked={!!contaMaior18[conta.id]} onChange={(e) => setContaMaior18((m) => ({ ...m, [conta.id]: e.target.checked }))} />
                  Todos desta conta são maiores de 18 anos
                </label>
                <div className="flex items-baseline justify-between">
                  <span className="text-base font-extrabold text-estrutura">Total da conta</span>
                  <span className="text-[26px] font-extrabold tabular-nums text-estrutura" data-testid="pdv-conta-total">{brl(conta.total)}</span>
                </div>
                <button type="button" onClick={() => { setContaId(null); setAviso(null); buscaRef.current?.focus(); }} data-testid="pdv-conta-guardar"
                  className="w-full rounded-full border-[1.5px] border-line bg-white px-4 py-3 text-[14px] font-bold text-estrutura hover:border-estrutura">
                  Guardar conta (continua aberta)
                </button>
                <button type="button" onClick={() => { if (conta.itens.length) void abrirFechamento(); }} disabled={!conta.itens.length || outroOperador} data-testid="pdv-conta-fechar"
                  className="w-full rounded-full bg-acao-600 px-4 py-3.5 text-[15px] font-bold text-white shadow-acao disabled:opacity-50">
                  Fechar conta (F12)
                </button>
              </div>
            </div>
          )}
          <div className={`min-h-0 flex-1 flex-col ${conta ? 'hidden' : 'flex'}`} data-testid="pdv-comanda">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-4">
              <div className="flex items-center gap-2">
                <Icone n="carrinho" className="h-5 w-5 text-estrutura" />
                <h2 className="text-lg font-extrabold text-estrutura">Comanda</h2>
                <span className="rounded-full bg-acao-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-acao-700"
                  data-testid="pdv-comanda-badge">{linhas.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={limpar} disabled={!linhas.length} data-testid="pdv-limpar"
                  className="flex items-center gap-1 rounded-full border border-line px-3 py-1 text-[13px] font-semibold text-ink-soft hover:border-estrutura hover:text-estrutura disabled:opacity-40">
                  <Icone n="lixo" className="h-3.5 w-3.5" />Limpar
                </button>
                {!ehDesktop && drawer && (
                  <button onClick={() => setDrawer(false)} data-testid="pdv-drawer-fechar" aria-label="Fechar comanda"
                    className="p-1 text-ink-soft hover:text-estrutura">
                    <Icone n="fechar" className="h-6 w-6" />
                  </button>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4" data-testid="pdv-comanda-itens">
              {linhas.map((l) => (
                <div key={l.produto.id} className="flex items-center gap-2 rounded-card border border-line bg-white px-3 py-3"
                  data-testid={`pdv-item-${l.produto.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{l.produto.nome}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-ink-soft">
                      {brl(l.produto.preco_varejo)} × {l.qtd} = <strong className="text-estrutura">{brl(l.produto.preco_varejo * l.qtd)}</strong>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 rounded-full border border-line p-0.5">
                    <button onClick={() => alterarQtd(l.produto.id, -1)} aria-label="Diminuir"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-fundo hover:text-estrutura">
                      <Icone n="menos" className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-6 text-center text-xs font-bold tabular-nums text-estrutura" data-testid="pdv-qtd">{l.qtd}</span>
                    <button onClick={() => alterarQtd(l.produto.id, 1)} aria-label="Aumentar"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-fundo hover:text-estrutura">
                      <Icone n="mais" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button onClick={() => remover(l.produto.id)} aria-label="Remover item"
                    className="shrink-0 rounded-panel p-1.5 text-ink-soft hover:bg-acao-100 hover:text-acao-700">
                    <Icone n="lixo" />
                  </button>
                </div>
              ))}

              {!linhas.length && (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center text-ink-soft" data-testid="pdv-comanda-vazio">
                  <Icone n="carrinho" className="mb-3 h-12 w-12 text-ink-faint" />
                  <p className="text-sm font-semibold">{aberto ? 'Nenhum item na comanda' : 'Caixa fechado'}</p>
                  <p className="mt-1 text-xs">{aberto ? 'Toque nos produtos ou passe o leitor.' : 'Abra o caixa para começar a vender.'}</p>
                </div>
              )}
            </div>

            {aviso && (
              <p role="alert" data-testid="pdv-aviso"
                className={`shrink-0 px-4 py-3 text-sm font-bold ${aviso.tipo === 'ok' ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'}`}>
                {aviso.texto}
              </p>
            )}

            {/* ------------------------------------------------ fechamento da venda */}
            <div className="shrink-0 space-y-4 border-t border-line bg-fundo/40 p-4">
              {/* cliente (opcional — 0008): identifica para histórico e CPF na nota */}
              {cliente ? (
                <div className="flex items-center justify-between gap-2 rounded-card border border-line bg-white px-3 py-2" data-testid="pdv-cliente">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icone n="usuario" className="h-4 w-4 shrink-0 text-estrutura" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-estrutura" data-testid="pdv-cliente-nome">{cliente.nome}</span>
                      {cliente.telefone && <span className="block text-xs text-ink-soft">{fmtFone(cliente.telefone)}</span>}
                      {forma === 'credito' && credito && (
                        <span className="block text-xs font-bold text-acao-700" data-testid="pdv-cliente-credito">
                          Em aberto {brl(credito.saldo)} · limite {credito.limite === null ? 'livre' : brl(credito.limite)}
                        </span>
                      )}
                    </span>
                  </span>
                  <button type="button" onClick={() => setCliente(null)} data-testid="pdv-cliente-remover" aria-label="Tirar cliente da venda"
                    className="p-1 text-ink-soft hover:text-bad"><Icone n="fechar" className="h-4 w-4" /></button>
                </div>
              ) : (
                <button type="button" onClick={() => setSeletorCliente(true)} disabled={!aberto} data-testid="pdv-cliente-btn"
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-dashed border-line-input bg-white px-4 py-2 text-[13px] font-bold text-ink-soft hover:border-estrutura hover:text-estrutura disabled:opacity-50">
                  <Icone n="usuario" className="h-4 w-4" />Identificar cliente <span className="font-semibold opacity-70">(F4 · opcional)</span>
                </button>
              )}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-ink-soft">
                  <span>Subtotal</span><span className="tabular-nums">{brl(subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-ink-soft">
                  <label htmlFor="pdv-desconto" className="flex items-center gap-1">
                    <Icone n="percentual" className="h-3.5 w-3.5" /> Desconto (R$)
                  </label>
                  <input id="pdv-desconto" type="number" min={0} step="0.01" value={desconto || ''} data-testid="pdv-desconto"
                    onChange={(e) => setDesconto(Math.max(0, Number(e.target.value)))}
                    placeholder="0,00"
                    className="w-28 rounded-full border-[1.5px] border-line-input bg-white px-3 py-1.5 text-right tabular-nums focus:outline-none" />
                </div>
                <div className="flex items-baseline justify-between border-t border-line pt-2.5">
                  <span className="text-base font-extrabold text-estrutura">Total a pagar</span>
                  <span data-testid="pdv-total" className="text-[26px] font-extrabold tabular-nums text-estrutura">{brl(total)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <span className="label">Forma de pagamento</span>
                <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Forma de pagamento">
                  {(([['pix', 'PIX', 'pix'], ['cartao', 'Cartão', 'cartao'], ['dinheiro', 'Dinheiro', 'dinheiro'], ['credito', 'Crédito', 'conta']] as const)).map(([id, rotulo, icone]) => (
                    <button key={id} data-testid={`pdv-forma-${id}`}
                      title={id === 'credito' ? 'Cliente leva e paga depois — exige cliente identificado' : undefined}
                      onClick={() => {
                        setForma(id);
                        // crédito sem cliente: abre a identificação na hora (o banco recusa crédito sem cliente)
                        if (id === 'credito' && !cliente && aberto) setSeletorCliente(true);
                      }}
                      role="radio" aria-checked={forma === id}
                      className={`flex flex-col items-center justify-center gap-1 rounded-card border px-2 py-2.5 text-[13px] ${forma === id
                        ? 'border-acao-600 bg-acao-100 font-bold text-acao-700'
                        : 'border-line bg-white font-semibold text-ink-soft hover:border-estrutura hover:text-estrutura'}`}>
                      <Icone n={icone} className="h-5 w-5" />
                      {rotulo}
                    </button>
                  ))}
                </div>
                {forma === 'dinheiro' && (
                  <div className="flex justify-between pt-1 text-sm text-ink-soft">
                    <label htmlFor="pdv-recebido">Valor recebido</label>
                    <span className="flex items-center gap-2">
                      {recebido !== '' && Number(recebido) >= total && total > 0 && (
                        <span className="font-bold tabular-nums text-ok">Troco {brl(Number(recebido) - total)}</span>
                      )}
                      <input id="pdv-recebido" type="number" min={0} step="0.01" data-testid="pdv-recebido"
                        value={recebido} onChange={(e) => setRecebido(e.target.value)}
                        placeholder={total.toFixed(2).replace('.', ',')}
                        className="w-28 rounded-full border-[1.5px] border-line-input bg-white px-3 py-1.5 text-right tabular-nums focus:outline-none" />
                    </span>
                  </div>
                )}
              </div>

              {temAdulto && (
                <label className="flex items-center gap-2 rounded-card bg-acao-100 px-3 py-2 text-sm font-bold text-acao-700" data-testid="pdv-maior18">
                  <input type="checkbox" checked={maior18} onChange={(e) => setMaior18(e.target.checked)} />
                  Cliente é maior de 18 anos
                </label>
              )}

              <div className="grid grid-cols-[auto_1fr] gap-2">
                <button onClick={() => setPainelAberto(true)} data-testid="pdv-caixa-btn"
                  className={`flex items-center justify-center gap-2 rounded-full border-[1.5px] px-4 py-3.5 text-[14px] font-bold ${aberto
                    ? 'border-line bg-white text-estrutura hover:border-estrutura'
                    : 'border-estrutura bg-estrutura text-white'}`}>
                  <Icone n="caixa" className="h-5 w-5" />
                  <span>Caixa <span className="hidden font-semibold opacity-70 sm:inline">(F8)</span></span>
                </button>
                <button onClick={finalizar} disabled={!aberto || !linhas.length || salvando || outroOperador} data-testid="pdv-finalizar"
                  className="flex min-w-0 items-center justify-center gap-2 rounded-full bg-acao-600 px-3 py-3.5 text-[15px] font-bold text-white shadow-acao disabled:cursor-not-allowed disabled:opacity-50">
                  <Icone n="confirmar" className="h-5 w-5 shrink-0" />
                  <span className="whitespace-nowrap">{salvando ? 'Finalizando…' : <>Finalizar venda<span className="hidden xl:inline"> (F12)</span></>}</span>
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {!ehDesktop && (
        <div className="fixed bottom-0 left-0 right-0 z-30">
          <button onClick={() => (aberto ? setDrawer(true) : setPainelAberto(true))} data-testid="pdv-barra-mobile"
            className={`w-full px-4 py-3.5 font-extrabold text-white ${aberto ? 'bg-acao-600' : 'bg-estrutura'}`}>
            {aberto ? `${linhas.length} itens · ${brl(total)} →` : 'Abrir caixa'}
          </button>
        </div>
      )}

      {drawer && !ehDesktop && (
        <div className="fixed inset-0 z-40 bg-estrutura/60" data-testid="pdv-drawer-fundo"
          onClick={() => setDrawer(false)} />
      )}

      {cpfModal && (
        <CpfNotaModal
          resumo={`${linhas.reduce((a, l) => a + l.qtd, 0).toLocaleString('pt-BR')} ${linhas.length === 1 && linhas[0].qtd === 1 ? 'item' : 'itens'} · ${brl(total)} no ${{ pix: 'PIX', cartao: 'Cartão', dinheiro: 'Dinheiro', credito: 'Crédito' }[forma]}`}
          cpfInicial={cliente?.cpf ?? null} pendente={salvando}
          confirmar={confirmarVenda} voltar={() => { setCpfModal(false); buscaRef.current?.focus(); }} />
      )}

      {pixVenda && (
        <PixQrModal valor={total} forma={forma} descricao={`Venda no balcão · ${linhas.reduce((a, l) => a + l.qtd, 0).toLocaleString('pt-BR')} itens${cliente ? ` · ${cliente.nome}` : ''}`}
          txid={pixVenda.txid} pendente={salvando}
          confirmar={(f) => { void gravarVenda(pixVenda.cpf, f); }}
          voltar={() => { setPixVenda(null); buscaRef.current?.focus(); }} />
      )}

      {novaConta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-estrutura/60 p-4" role="dialog" aria-modal="true" aria-label="Abrir conta de cliente"
          data-testid="pdv-conta-modal"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setNovaConta(null); buscaRef.current?.focus(); } }}>
          <form className="w-full max-w-md space-y-4 rounded-banner bg-white p-6"
            onSubmit={(e) => { e.preventDefault(); void criarConta(); }}>
            <div>
              <h2 className="text-xl font-extrabold text-estrutura">Conta de cliente</h2>
              <p className="text-sm text-ink-soft">Consumo no local, como mesa de bar. O nome aparece no quadro &quot;Contas abertas&quot;.</p>
            </div>
            <label className="block">
              <span className="label">Nome da conta</span>
              <input autoFocus value={novaConta.nome} maxLength={60} data-testid="pdv-conta-nome" placeholder="Ex.: Grupo do Carlos"
                onChange={(e) => setNovaConta((n) => (n ? { ...n, nome: e.target.value } : n))}
                className="mt-1 w-full rounded-full border-[1.5px] border-line-input px-4 py-2.5 focus:border-estrutura focus:outline-none" />
            </label>
            <label className="flex items-center gap-2 rounded-card bg-acao-100 px-3 py-2 text-sm font-bold text-acao-700">
              <input type="checkbox" checked={novaConta.maior18} data-testid="pdv-conta-maior18"
                onChange={(e) => setNovaConta((n) => (n ? { ...n, maior18: e.target.checked } : n))} />
              Todos são maiores de 18 anos (documento conferido)
            </label>
            <div className="flex items-center justify-between gap-2 text-sm">
              {novaConta.cliente
                ? <span className="font-bold text-estrutura" data-testid="pdv-conta-cliente">Cliente: {novaConta.cliente.nome}</span>
                : <span className="text-ink-soft">Cliente cadastrado: opcional (exigido para pagar no Crédito)</span>}
              <button type="button" onClick={() => setSeletorConta(true)} data-testid="pdv-conta-vincular"
                className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-bold text-estrutura hover:border-estrutura">
                {novaConta.cliente ? 'Trocar' : 'Vincular cliente'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setNovaConta(null); buscaRef.current?.focus(); }}
                className="rounded-full border border-line px-4 py-3 font-bold text-ink-soft">Cancelar</button>
              <button type="submit" disabled={!novaConta.nome.trim() || salvando} data-testid="pdv-conta-abrir"
                className="rounded-full bg-acao-600 px-4 py-3 font-extrabold text-white disabled:opacity-50">{salvando ? 'Abrindo…' : 'Abrir conta'}</button>
            </div>
          </form>
        </div>
      )}

      {seletorConta && (
        <ClienteSeletor fechar={() => setSeletorConta(false)}
          onEscolher={(c) => setNovaConta((n) => (n ? { ...n, cliente: c, nome: n.nome.trim() ? n.nome : c.nome } : n))} />
      )}

      {fecharContaAberto && conta && sessao && (
        <FecharContaModal conta={conta} sessaoId={sessao.sessaoId} maior18={!!contaMaior18[conta.id]} pausado={!!recibo}
          aoMarcar18={(v) => setContaMaior18((m) => ({ ...m, [conta.id]: v }))}
          fechar={() => { setFecharContaAberto(false); buscaRef.current?.focus(); }} aoPagar={aoPagarConta} />
      )}

      {recibo && <ReciboVenda r={recibo} fechar={() => { setRecibo(null); buscaRef.current?.focus(); }} />}

      {seletorCliente && (
        <ClienteSeletor fechar={() => { setSeletorCliente(false); buscaRef.current?.focus(); }} onEscolher={setCliente} />
      )}

      {painelAberto && (
        <PainelCaixa
          caixa={caixas.find((c) => c.id === caixaId)!}
          sessao={sessao} turno={turno} papel={papel} nome={nome}
          aba={abaCaixa} setAba={setAbaCaixa}
          fechar={() => setPainelAberto(false)}
          aoAbrir={aoAbrir}
        />
      )}

      {cadastro && localAtual && (
        <CadastroRapidoProduto
          localId={localAtual}
          localNome={caixas.find((c) => c.id === caixaId)?.local_nome ?? localAtual}
          prefill={cadastro.prefill}
          fechar={() => setCadastro(null)}
          onCriado={aoCadastrar}
        />
      )}

      {precoAberto && <PrecificacaoModal fechar={() => setPrecoAberto(false)} />}
      {siteAberto && <SiteLojaModal fechar={() => setSiteAberto(false)} />}
      {vendasAberta && <VendasDiaModal fechar={() => setVendasAberta(false)} />}
    </div>
  );
}

// ================================================================= painel caixa (CX-01..10)
function PainelCaixa({ caixa, sessao, turno, papel, nome, aba, setAba, fechar, aoAbrir }: {
  caixa: CaixaInfo; sessao: ResumoCaixa | null; turno: ResumoCaixa | null;
  papel: Papel; nome: string; aba: 'mov' | 'fechar'; setAba: (a: 'mov' | 'fechar') => void;
  fechar: () => void; aoAbrir: () => void;
}) {
  const aberto = !!sessao?.aberta;
  const [stAbrir, acaoAbrir, pendAbrir] = useActionState<EstadoCaixa, FormData>(abrirCaixa, {});
  const [stMov, acaoMov, pendMov] = useActionState<EstadoCaixa, FormData>(lancarMovimento, {});
  const [stFech, acaoFech, pendFech] = useActionState<ResultadoFechamento, FormData>(fecharCaixa, {});

  // refresh do pai só quando uma ação termina (identidade nova do estado) — nunca em loop:
  // antes, aoAbrir era recriado a cada render e o efeito de stAbrir re-disparava sem parar
  const stMovAnterior = useRef(stMov);
  useEffect(() => {
    if (stMov === stMovAnterior.current) return;
    stMovAnterior.current = stMov;
    if (!stMov.erro) aoAbrir();                       // movimento lançado → gaveta/lista atualizam
  }, [stMov, aoAbrir]);
  useEffect(() => { if (stAbrir.sessaoId) aoAbrir(); }, [stAbrir.sessaoId, aoAbrir]);

  // caixa fechou → o pai recarrega (sessão vira null) e o resultado fica até "Concluir"
  const difFech = typeof stFech.diferenca === 'number' && !stFech.erro ? stFech.diferenca : null;
  useEffect(() => { if (difFech !== null) aoAbrir(); }, [difFech, aoAbrir]);
  // relatório impresso: abre sozinho ao fechar o turno; com o caixa aberto vira "leitura parcial"
  const [relatorio, setRelatorio] = useState<string | null>(null);
  const fechSessao = stFech.sessaoId;
  useEffect(() => { if (fechSessao) setRelatorio(fechSessao); }, [fechSessao]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-testid="pdv-painel">
      <div className="absolute inset-0 bg-estrutura/60" onClick={fechar} />
      <div className="relative w-full max-w-xl rounded-t-banner bg-white p-5 sm:rounded-banner">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-estrutura">Caixa · {caixa.nome}</h2>
          <button onClick={fechar} aria-label="Fechar painel" className="text-ink-soft">✕</button>
        </div>

        {difFech !== null ? (
          <div className="space-y-4 text-center" data-testid="pdv-resultado">
            <p className={`rounded-card px-4 py-4 text-lg font-extrabold ${Math.abs(difFech) < 0.005 ? 'bg-ok/10 text-ok' : difFech > 0 ? 'bg-acao-100 text-acao-700' : 'bg-bad/10 text-bad'}`}
              data-testid="pdv-resultado-fechamento">
              {Math.abs(difFech) < 0.005 ? 'Caixa confere.'
                : difFech > 0 ? `Sobra de ${brl(difFech)}`
                : `Falta de ${brl(Math.abs(difFech))}`}
            </p>
            <p className="text-sm text-ink-soft">Esperado {brl(stFech.esperado ?? 0)} · turno encerrado</p>
            {stFech.sessaoId && (
              <button type="button" onClick={() => setRelatorio(stFech.sessaoId ?? null)} data-testid="pdv-relatorio-abrir"
                className="w-full rounded-full border-[1.5px] border-estrutura px-5 py-3 font-extrabold text-estrutura">🖨 Imprimir relatório de fechamento</button>
            )}
            <button onClick={fechar} data-testid="pdv-resultado-ok"
              className="w-full rounded-full bg-acao-600 px-5 py-3 font-extrabold text-white">Concluir</button>
          </div>
        ) : !aberto ? (
          <form action={acaoAbrir} className="space-y-3" data-testid="pdv-form-abrir" noValidate>
            {turno && (
              <div className="rounded-card bg-fundo p-3 text-sm">
                <p className="font-bold text-estrutura">Último turno</p>
                <p className="text-ink-soft">Contado {brl(turno.valorAbertura)} · esperado {brl(turno.dinheiroEsperado)}</p>
              </div>
            )}
            <input type="hidden" name="caixaId" value={caixa.id} />
            <label className="block">
              <span className="text-sm font-bold text-estrutura">Valor de abertura (R$)</span>
              <input name="valorAbertura" type="number" min={0} step="0.01" required autoFocus defaultValue=""
                data-testid="pdv-valor-abertura"
                className="mt-1 w-full rounded-xl border-[1.5px] border-line-input px-3.5 py-2.5 focus:outline-none focus:border-estrutura" />
            </label>
            <p role="alert" className="min-h-5 text-sm font-bold text-bad">{stAbrir.erro}</p>
            <button disabled={pendAbrir} data-testid="pdv-abrir-submit"
              className="w-full rounded-full bg-acao-600 px-5 py-3 font-extrabold text-white disabled:opacity-50">
              {pendAbrir ? 'Abrindo…' : `Abrir caixa como ${nome}`}
            </button>
          </form>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-card bg-fundo p-3"><p className="text-xs text-ink-soft">Abertura</p><p className="font-bold">{brl(sessao.valorAbertura)}</p></div>
              <div className="rounded-card bg-fundo p-3"><p className="text-xs text-ink-soft">Vendas</p><p className="font-bold">{sessao.vendasQtd} · {brl(sessao.vendasTotal)}</p></div>
              <div className="rounded-card bg-acao-600 p-3 text-white"><p className="text-xs">Gaveta</p><p className="font-bold">{brl(sessao.dinheiroEsperado)}</p></div>
            </div>

            <div className="mb-3 flex gap-2">
              <button onClick={() => setAba('mov')} data-testid="pdv-aba-mov"
                className={`rounded-full px-4 py-1.5 text-sm font-bold ${aba === 'mov' ? 'bg-estrutura text-white' : 'border border-line'}`}>Movimentação</button>
              <button onClick={() => setAba('fechar')} data-testid="pdv-aba-fechar"
                className={`rounded-full px-4 py-1.5 text-sm font-bold ${aba === 'fechar' ? 'bg-estrutura text-white' : 'border border-line'}`}>Fechar caixa</button>
            </div>

            {aba === 'mov' ? (
              <form action={acaoMov} className="space-y-3" data-testid="pdv-form-mov" noValidate>
                <input type="hidden" name="sessaoId" value={sessao.sessaoId} />
                <div className="flex gap-2">
                  <label className="flex-1 rounded-card border border-line p-2 text-center text-sm font-bold">
                    <input type="radio" name="tipo" value="sangria" defaultChecked className="mr-1" /> Sangria (↑)
                  </label>
                  <label className="flex-1 rounded-card border border-line p-2 text-center text-sm font-bold">
                    <input type="radio" name="tipo" value="suprimento" className="mr-1" /> Suprimento (↓)
                  </label>
                </div>
                <input name="valor" type="number" min={0.01} step="0.01" required placeholder="Valor (R$)"
                  data-testid="pdv-mov-valor" className="w-full rounded-xl border-[1.5px] border-line-input px-3.5 py-2.5 focus:outline-none" />
                <input name="motivo" required placeholder="Motivo" data-testid="pdv-mov-motivo"
                  className="w-full rounded-xl border-[1.5px] border-line-input px-3.5 py-2.5 focus:outline-none" />
                <p role="alert" className="min-h-5 text-sm font-bold text-bad">{stMov.erro}</p>
                <button disabled={pendMov} data-testid="pdv-mov-submit"
                  className="w-full rounded-full bg-acao-600 px-5 py-2.5 font-bold text-white disabled:opacity-50">
                  {pendMov ? 'Lançando…' : 'Lançar movimento'}
                </button>
                {sessao.movimentos.length > 0 && (
                  <ul className="space-y-1 text-sm" data-testid="pdv-mov-lista">
                    {sessao.movimentos.map((m) => (
                      <li key={m.id} className="flex justify-between rounded-card bg-fundo px-3 py-1.5">
                        <span className="text-ink-soft">{m.tipo} · {m.motivo}</span>
                        <span className={`font-bold ${m.tipo === 'sangria' ? 'text-bad' : 'text-ok'}`}>
                          {m.tipo === 'sangria' ? '−' : '+'}{brl(m.valor)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </form>
            ) : (
              <form action={acaoFech} className="space-y-3" data-testid="pdv-form-fechar" noValidate>
                <input type="hidden" name="sessaoId" value={sessao.sessaoId} />
                <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4">
                  <div className="rounded-card bg-fundo p-2"><p className="text-xs text-ink-soft">PIX</p><p className="font-bold">{brl(sessao.porForma.pix)}</p></div>
                  <div className="rounded-card bg-fundo p-2"><p className="text-xs text-ink-soft">Cartão</p><p className="font-bold">{brl(sessao.porForma.cartao)}</p></div>
                  <div className="rounded-card bg-fundo p-2"><p className="text-xs text-ink-soft">Dinheiro</p><p className="font-bold">{brl(sessao.porForma.dinheiro)}</p></div>
                  <div className="rounded-card bg-fundo p-2" title="Vendido no crédito: não entra na gaveta"><p className="text-xs text-ink-soft">Crédito</p><p className="font-bold">{brl(sessao.porForma.credito)}</p></div>
                </div>
                <p className="text-sm text-ink-soft">Esperado na gaveta: <strong>{brl(sessao.dinheiroEsperado)}</strong></p>
                <input name="valorContado" type="number" min={0} step="0.01" required placeholder="Dinheiro contado (R$)"
                  data-testid="pdv-valor-contado" className="w-full rounded-xl border-[1.5px] border-line-input px-3.5 py-2.5 focus:outline-none" />
                <p role="alert" className="min-h-5 text-sm font-bold text-bad">{stFech.erro}</p>
                <button type="button" onClick={() => setRelatorio(sessao.sessaoId)} data-testid="pdv-relatorio-parcial"
                  className="w-full rounded-full border border-line px-5 py-2.5 text-sm font-bold text-estrutura hover:border-estrutura">🖨 Imprimir leitura parcial (sem fechar)</button>
                <button disabled={pendFech} data-testid="pdv-fechar-submit"
                  className="w-full rounded-full bg-estrutura px-5 py-3 font-extrabold text-white disabled:opacity-50">
                  {pendFech ? 'Fechando…' : `Fechar caixa de ${sessao.operador}`}
                </button>
              </form>
            )}
            {papel !== 'master' && <p className="mt-2 text-xs text-ink-soft">Operador da sessão: {sessao.operador}</p>}
          </>
        )}
      </div>
      {relatorio && <RelatorioFechamento sessaoId={relatorio} fechar={() => setRelatorio(null)} />}
    </div>
  );
}
