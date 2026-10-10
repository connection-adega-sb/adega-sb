'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  criarProdutoRapido, listarCategorias, type Categoria, type ProdutoNovo,
} from '@/app/produtos/actions';

// Modal de cadastro rápido de produto — aberto de QUALQUER módulo de venda no meio da operação
// (pedido do cliente 2026-10-10). O fluxo é: cadastrar → o chamador já mete o produto na comanda
// → modal fecha → o operador continua a venda e finaliza. Ninguém sai da tela.
// Só monta o FormData: nome, tipo, preço e saldo são validados NO SERVIDOR (0007 produto_criar).

type Props = {
  localId: string;
  localNome: string;
  prefill?: { nome?: string; codigoBarras?: string };
  fechar: () => void;
  onCriado: (p: ProdutoNovo) => void | Promise<void>;
};

// categorias não mudam dentro de uma venda — busca uma vez e reusa nas aberturas seguintes
let cacheCategorias: Categoria[] | null = null;

const CAMPO = 'mt-1 w-full rounded-xl border-[1.5px] border-line-input bg-white px-3.5 py-2.5 focus:outline-none focus:border-estrutura';
const LBL = 'block text-sm font-bold text-estrutura';

export function CadastroRapidoProduto({ localId, localNome, prefill, fechar, onCriado }: Props) {
  const [cats, setCats] = useState<Categoria[]>(cacheCategorias ?? []);
  const [nome, setNome] = useState(prefill?.nome ?? '');
  const [ean, setEan] = useState(prefill?.codigoBarras ?? '');
  const [categoria, setCategoria] = useState('');
  const [tipo, setTipo] = useState('revenda');
  const [unidade, setUnidade] = useState('un');
  const [preco, setPreco] = useState('');
  const [custo, setCusto] = useState('');
  const [conteudo, setConteudo] = useState('');
  const [conteudoUn, setConteudoUn] = useState('');
  const [saldo, setSaldo] = useState('');
  const [adulto, setAdulto] = useState(false);
  const [fumigeno, setFumigeno] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);
  const nomeRef = useRef<HTMLInputElement>(null);
  const fecharRef = useRef(fechar);
  useEffect(() => { fecharRef.current = fechar; });

  // Esc fecha o modal em qualquer módulo (PDV tem handler próprio; aqui cobre o bar e o futuro)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); fecharRef.current(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    if (cacheCategorias) return;
    let vivo = true;
    listarCategorias()
      .then((c) => { cacheCategorias = c; if (vivo) setCats(c); })
      .catch(() => { /* sem categoria o cadastro ainda funciona (campo opcional) */ });
    return () => { vivo = false; };
  }, []);

  useEffect(() => { nomeRef.current?.focus(); }, []);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pendente) return;
    setErro(null);
    setPendente(true);
    try {
      const fd = new FormData(e.currentTarget);
      fd.set('localId', localId);
      const r = await criarProdutoRapido({}, fd);
      if (r.erro) { setErro(r.erro); return; }
      if (r.produto) {
        const p = r.produto;
        fechar();
        await onCriado(p);
      }
    } catch (ex) {
      setErro(ex instanceof Error ? ex.message : 'Falha ao cadastrar o produto.');
    } finally {
      setPendente(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-testid="cadastro-modal" role="dialog" aria-modal="true" aria-label="Cadastrar produto">
      <div className="absolute inset-0 bg-estrutura/60" onClick={fechar} />
      <form
        onSubmit={enviar}
        noValidate
        className="relative max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-banner bg-white p-5 sm:rounded-banner"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-estrutura">Produto novo</h2>
          <button type="button" onClick={fechar} aria-label="Fechar cadastro" data-testid="cadastro-fechar" className="text-ink-soft">✕</button>
        </div>
        <p className="mb-4 text-sm text-ink-soft">
          Cadastre agora e volte para a venda — o produto entra na comanda sozinho.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`${LBL} sm:col-span-2`}>
            Nome do produto *
            <input
              ref={nomeRef} name="nome" value={nome} onChange={(e) => setNome(e.target.value)}
              required data-testid="cadastro-nome" placeholder="Ex.: Cerveja Artesanal 500 ml" className={CAMPO}
            />
          </label>

          <label className={LBL}>
            Código de barras
            <input
              name="codigoBarras" value={ean} onChange={(e) => setEan(e.target.value)} inputMode="numeric"
              data-testid="cadastro-ean" placeholder="opcional" className={CAMPO}
            />
          </label>

          <label className={LBL}>
            Categoria
            <select name="categoriaId" value={categoria} onChange={(e) => setCategoria(e.target.value)} data-testid="cadastro-categoria" className={CAMPO}>
              <option value="">Sem categoria</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>

          <label className={LBL}>
            Tipo
            <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} data-testid="cadastro-tipo" className={CAMPO}>
              <option value="revenda">Revenda (revende a embalagem)</option>
              <option value="preparado">Preparado (copão/coquetel)</option>
              <option value="insumo">Insumo (usado em ficha técnica)</option>
            </select>
          </label>

          <label className={LBL}>
            Unidade de venda
            <select name="unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)} data-testid="cadastro-unidade" className={CAMPO}>
              <option value="un">un (unidade)</option>
              <option value="kg">kg (quilo)</option>
              <option value="l">l (litro)</option>
            </select>
          </label>

          <label className={LBL}>
            Preço de venda (R$) *
            <input
              name="precoVarejo" value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal"
              required data-testid="cadastro-preco" placeholder="0,00" className={CAMPO}
            />
          </label>

          <label className={LBL}>
            Custo médio (R$)
            <input
              name="custoMedio" value={custo} onChange={(e) => setCusto(e.target.value)} inputMode="decimal"
              data-testid="cadastro-custo" placeholder="opcional" className={CAMPO}
            />
          </label>

          <label className={LBL}>
            Conteúdo da embalagem
            <input
              name="conteudo" value={conteudo} onChange={(e) => setConteudo(e.target.value)} inputMode="decimal"
              data-testid="cadastro-conteudo" placeholder="Ex.: 350" className={CAMPO}
            />
          </label>

          <label className={LBL}>
            Unidade do conteúdo
            <select name="conteudoUnidade" value={conteudoUn} onChange={(e) => setConteudoUn(e.target.value)} data-testid="cadastro-conteudo-un" className={CAMPO}>
              <option value="">—</option>
              <option value="ml">ml</option>
              <option value="g">g</option>
              <option value="un">un</option>
            </select>
          </label>

          <label className={`${LBL} sm:col-span-2`}>
            Saldo inicial em <strong>{localNome}</strong>
            <input
              name="saldoInicial" value={saldo} onChange={(e) => setSaldo(e.target.value)} inputMode="decimal"
              data-testid="cadastro-saldo" placeholder="0 (deixe vazio se não souber)" className={CAMPO}
            />
            <span className="mt-1 block text-xs font-normal text-ink-soft">
              Entra como movimento de <strong>entrada</strong> auditado — o estoque nunca é digitado à mão depois.
            </span>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 rounded-card bg-fundo px-3 py-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox" name="adulto" checked={adulto}
              onChange={(e) => { setAdulto(e.target.checked); if (!e.target.checked) setFumigeno(false); }}
              data-testid="cadastro-adulto"
            />
            <span className="font-bold text-estrutura">+18</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox" name="fumigeno" checked={fumigeno}
              onChange={(e) => { setFumigeno(e.target.checked); if (e.target.checked) setAdulto(true); }}
              data-testid="cadastro-fumigeno"
            />
            <span className="font-bold text-estrutura">Fumígeno (cigarro — sempre +18 e nunca fracionado)</span>
          </label>
        </div>

        <p role="alert" data-testid="cadastro-erro" className="min-h-5 pt-3 text-sm font-bold text-bad">{erro}</p>

        <div className="mt-2 flex gap-2">
          <button
            type="button" onClick={fechar} data-testid="cadastro-cancelar"
            className="flex-1 rounded-full border-[1.5px] border-line-input px-5 py-3 font-bold transition-colors hover:bg-fundo"
          >
            Cancelar
          </button>
          <button
            type="submit" disabled={pendente} data-testid="cadastro-submit"
            className="flex-[2] rounded-full bg-acao-600 px-5 py-3 font-extrabold text-white disabled:opacity-50"
          >
            {pendente ? 'Cadastrando…' : 'Cadastrar e voltar para a venda'}
          </button>
        </div>
      </form>
    </div>
  );
}
