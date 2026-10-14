'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { lerChavePix, salvarChavePix, type ChavePix } from '@/app/pdv/actions';
import { payloadPix, txidPix } from '@/lib/pix';
import { brl } from '@/lib/formatar';

// Ao receber (balcão e Conta de cliente), em qualquer forma menos crédito: 1º pergunta "Gerar QR Code PIX?".
// Sim → QR com o valor já preenchido (BR Code estático) e a venda grava como PIX no "PIX recebido".
// Não → grava na forma escolhida. O QR NÃO confirma sozinho: o caixa confere no app do banco. Esc volta.
// Sem chave cadastrada: o master cadastra aqui mesmo (fica em tenants.config.pix); os outros podem receber sem QR.
type Forma = 'pix' | 'cartao' | 'dinheiro' | 'credito';
const ROTULO: Record<Forma, string> = { pix: 'PIX', cartao: 'Cartão', dinheiro: 'Dinheiro', credito: 'Crédito' };

export function PixQrModal({ valor, forma, descricao, txid, pendente, confirmar, voltar }: {
  valor: number; forma: Forma; descricao: string; txid: string; pendente: boolean;
  confirmar: (forma: Forma) => void; voltar: () => void;
}) {
  const [etapa, setEtapa] = useState<'pergunta' | 'qr'>('pergunta');
  const [pix, setPix] = useState<ChavePix | null>(null);
  const [podeEditar, setPodeEditar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ chave: '', nome: '', cidade: '' });
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [salvandoChave, setSalvandoChave] = useState(false);
  // Enter: na pergunta = botão principal (PIX → gerar QR; outras → receber sem QR); no QR = "PIX recebido"
  const principal = () => {
    if (etapa === 'qr') confirmar('pix');
    else if (forma === 'pix') setEtapa('qr');
    else confirmar(forma);
  };
  const ref = useRef({ principal, voltar, pendente, editando });
  useEffect(() => { ref.current = { principal, voltar, pendente, editando }; });

  useEffect(() => {
    let vivo = true;
    lerChavePix().then((r) => { if (!vivo) return; setPix(r.pix); setPodeEditar(r.podeEditar); setCarregando(false); })
      .catch(() => { if (vivo) { setCarregando(false); setErro('Não foi possível ler a chave PIX.'); } });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const { principal: ok, voltar: sair, pendente: p, editando: ed } = ref.current;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!p) sair(); return; }
      if (e.key === 'Enter' && !ed && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); e.stopPropagation(); if (!p) ok(); return; }
      if (e.key === 'F12' || e.key === 'F6') { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  const copiaCola = useMemo(() => (pix ? payloadPix(pix, Math.round(valor * 100) / 100, txidPix(txid)) : ''), [pix, valor, txid]);
  const svg = useMemo(() => {
    if (!copiaCola) return null;
    const qr = qrcode(0, 'M');
    qr.addData(copiaCola, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const m = 4;   // margem branca exigida pelos leitores
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + m} ${y + m}h1v1h-1z`;
    return { d, lado: n + m * 2 };
  }, [copiaCola]);

  async function gravarChave() {
    setErro(''); setSalvandoChave(true);
    const r = await salvarChavePix(form);
    setSalvandoChave(false);
    if (r.erro || !r.pix) { setErro(r.erro ?? 'Não foi possível salvar.'); return; }
    setPix(r.pix); setEditando(false);
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(copiaCola); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
    catch { setErro('Não consegui copiar: selecione o texto e copie.'); }
  }

  const CAMPO = 'mt-1 w-full rounded-lg border border-estrutura/40 bg-white px-3 py-2 text-[14px] text-estrutura focus:border-acao-600 focus:outline-none';
  const semChave = etapa === 'qr' && !carregando && !pix;
  const mostrarForm = etapa === 'qr' && podeEditar && (editando || semChave);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Receber" data-testid="pdv-pix-modal">
      <div className="absolute inset-0 bg-estrutura/70" onClick={() => !pendente && voltar()} />
      <div className="relative w-full max-w-md rounded-t-banner bg-white p-5 sm:rounded-banner">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[.12em] text-acao-700">{etapa === 'qr' ? 'Receber no PIX' : `Receber · ${ROTULO[forma]}`}</p>
            <h2 className="text-3xl font-extrabold tabular-nums text-estrutura" data-testid="pix-valor">{brl(valor)}</h2>
            <p className="text-sm text-ink-soft">{descricao}</p>
          </div>
          <button type="button" onClick={voltar} disabled={pendente}
            className="rounded-full border border-estrutura/40 px-3 py-1.5 text-xs font-bold text-estrutura hover:bg-fundo disabled:opacity-50"
            data-testid="pix-voltar">← Voltar (Esc)</button>
        </div>

        {etapa === 'pergunta' && (
          <div className="mt-5" data-testid="pix-pergunta">
            <p className="text-base font-bold text-estrutura">Gerar QR Code PIX para o cliente pagar?</p>
            <div className="mt-3 grid gap-2">
              <button type="button" onClick={() => setEtapa('qr')} disabled={pendente} data-testid="pix-gerar"
                className={`rounded-full px-4 py-3 text-base font-extrabold disabled:opacity-50 ${forma === 'pix' ? 'bg-acao-600 text-white shadow-acao' : 'border-[1.5px] border-estrutura bg-white text-estrutura'}`}>
                ▦ Sim, gerar QR Code PIX{forma !== 'pix' ? ' (registra como PIX)' : ''}
              </button>
              <button type="button" onClick={() => confirmar(forma)} disabled={pendente} data-testid="pix-sem-qr"
                className={`rounded-full px-4 py-3 text-base font-extrabold disabled:opacity-50 ${forma !== 'pix' ? 'bg-acao-600 text-white shadow-acao' : 'border border-line bg-white text-estrutura'}`}>
                {pendente ? 'Gravando…' : forma === 'pix' ? 'Não, já recebi o PIX' : `Não, receber no ${ROTULO[forma]}`}
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-ink-soft"><strong>Enter</strong> = botão laranja · <strong>Esc</strong> volta</p>
          </div>
        )}

        {etapa === 'qr' && carregando && <p className="py-10 text-center text-sm text-ink-soft">Carregando a chave PIX…</p>}

        {etapa === 'qr' && !carregando && pix && !editando && svg && (
          <div className="mt-4 flex flex-col items-center">
            <svg viewBox={`0 0 ${svg.lado} ${svg.lado}`} className="h-64 w-64 rounded-lg border border-line bg-white" shapeRendering="crispEdges"
              role="img" aria-label={`QR Code PIX de ${brl(valor)}`} data-testid="pix-qr">
              <rect width={svg.lado} height={svg.lado} fill="#fff" />
              <path d={svg.d} fill="#000" />
            </svg>
            <p className="mt-2 text-center text-xs text-ink-soft">
              Para <strong className="text-estrutura">{pix.nome}</strong> · chave {pix.tipo || 'PIX'} <span className="tabular-nums">{pix.chave}</span>
              {podeEditar && <> · <button type="button" className="font-bold text-acao-700 underline" onClick={() => { setForm({ chave: pix.chave, nome: pix.nome, cidade: pix.cidade }); setEditando(true); }}>trocar</button></>}
            </p>
            <button type="button" onClick={copiar} className="mt-2 rounded-full border border-line px-4 py-1.5 text-xs font-bold text-estrutura hover:border-estrutura" data-testid="pix-copiar">
              {copiado ? 'Copiado ✓' : 'Copiar PIX copia e cola'}
            </button>
          </div>
        )}

        {mostrarForm && (
          <div className="mt-4 rounded-xl bg-fundo p-4" data-testid="pix-form">
            <p className="text-sm font-bold text-estrutura">{semChave ? 'Cadastre a chave PIX da empresa (uma vez só)' : 'Trocar a chave PIX'}</p>
            <label className="mt-3 block text-[12.5px] font-semibold text-estrutura">Chave PIX
              <input className={CAMPO} value={form.chave} onChange={(e) => setForm({ ...form, chave: e.target.value })}
                placeholder="CNPJ, CPF, e-mail, celular ou chave aleatória" data-testid="pix-chave" autoFocus /></label>
            <label className="mt-2 block text-[12.5px] font-semibold text-estrutura">Nome do recebedor <span className="text-[11px] font-normal text-ink-soft">como aparece no banco</span>
              <input className={CAMPO} value={form.nome} maxLength={25} onChange={(e) => setForm({ ...form, nome: e.target.value })} data-testid="pix-nome" /></label>
            <label className="mt-2 block text-[12.5px] font-semibold text-estrutura">Cidade
              <input className={CAMPO} value={form.cidade} maxLength={15} onChange={(e) => setForm({ ...form, cidade: e.target.value })} data-testid="pix-cidade" /></label>
            <div className="mt-3 flex gap-2">
              {pix && <button type="button" onClick={() => setEditando(false)} className="rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-estrutura">Cancelar</button>}
              <button type="button" onClick={gravarChave} disabled={salvandoChave} data-testid="pix-salvar-chave"
                className="flex-1 rounded-full bg-estrutura px-4 py-2 text-sm font-extrabold text-white disabled:opacity-50">{salvandoChave ? 'Salvando…' : 'Salvar chave e gerar QR'}</button>
            </div>
          </div>
        )}

        {semChave && !podeEditar && (
          <p className="mt-4 rounded-xl bg-fundo p-4 text-sm text-estrutura" data-testid="pix-sem-chave">
            A chave PIX da empresa ainda não foi cadastrada: peça ao master. Dá para receber pela maquininha e confirmar abaixo.
          </p>
        )}

        {erro && <p role="alert" className="mt-3 text-sm font-bold text-bad" data-testid="pix-erro">{erro}</p>}

        {etapa === 'qr' && <>
        <button type="button" onClick={() => confirmar('pix')} disabled={pendente || carregando} data-testid="pix-confirmar"
          className="mt-4 w-full rounded-full bg-acao-600 px-4 py-3 text-base font-extrabold text-white shadow-acao disabled:opacity-50">
          {pendente ? 'Gravando…' : `PIX recebido ✓ — ${brl(valor)}`}
        </button>
        <p className="mt-2 text-center text-xs text-ink-soft">Confira a entrada no app do banco antes de confirmar · <strong>Enter</strong> confirma · <strong>Esc</strong> volta</p>
        </>}
      </div>
    </div>
  );
}
