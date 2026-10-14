'use server';
import { exigirSessao } from '@/lib/sessao';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Consulta de produto pelo código de barras (GTIN/EAN) para preencher o cadastro sozinho.
// Ordem: (1) já existe no NOSSO catálogo? avisa e não duplica; (2) Bluesoft Cosmos — base brasileira com
// nome, marca, NCM e CEST (precisa do token COSMOS_TOKEN no .env.local e no Netlify; sem token, pula);
// (3) Open Food Facts — base aberta e gratuita, sem dados fiscais. Tudo no SERVIDOR (o token nunca vai ao navegador).
// NCM/CEST vindos de base externa são SUGESTÃO: o contador confere antes da NFC-e (F10).

export type DadosGtin = {
  fonte: 'catalogo' | 'cosmos' | 'openfoodfacts' | 'nenhuma';
  jaCadastrado?: string;            // nome do produto que já usa este código no nosso catálogo
  nome?: string;
  marca?: string;
  ncm?: string;                     // 8 dígitos
  ncmDescricao?: string;
  cest?: string;                    // 7 dígitos
  conteudo?: number;
  conteudoUnidade?: 'ml' | 'g' | 'un';
  adultoSugerido?: boolean;         // NCM de bebida alcoólica (2203–2208) ou tabaco (24xx)
  fumigenoSugerido?: boolean;       // NCM 2402/2403 (cigarro, fumo)
  aviso?: string;
};

const PAPEIS = ['master', 'gerente', 'caixa', 'bartender', 'estoquista'] as const;
const so = (t: string | null | undefined) => (t ?? '').replace(/\D/g, '');

async function buscarJson(url: string, headers: Record<string, string>): Promise<unknown | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// "750 ml", "350ml", "1 L", "1,5l", "500 g", "1kg" → { conteudo, unidade }
function lerConteudo(txt: string | undefined): { conteudo?: number; conteudoUnidade?: 'ml' | 'g' } {
  if (!txt) return {};
  const m = txt.toLowerCase().replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(ml|l|lt|litros?|g|kg)\b/);
  if (!m) return {};
  const v = Number(m[1]);
  if (!v) return {};
  if (m[2] === 'ml') return { conteudo: v, conteudoUnidade: 'ml' };
  if (m[2] === 'g') return { conteudo: v, conteudoUnidade: 'g' };
  if (m[2] === 'kg') return { conteudo: Math.round(v * 1000), conteudoUnidade: 'g' };
  return { conteudo: Math.round(v * 1000), conteudoUnidade: 'ml' };   // l, lt, litro(s)
}

function sugerirPeloNcm(ncm: string | undefined): Pick<DadosGtin, 'adultoSugerido' | 'fumigenoSugerido'> {
  if (!ncm) return {};
  const cap = Number(ncm.slice(0, 4));
  const fumigeno = cap === 2402 || cap === 2403;
  const alcool = cap >= 2203 && cap <= 2208;
  return { adultoSugerido: alcool || fumigeno, fumigenoSugerido: fumigeno };
}

type Cosmos = {
  description?: string;
  brand?: { name?: string };
  ncm?: { code?: string; description?: string; full_description?: string };
  cest?: { code?: string } | null;
  net_weight?: number;
};

type Off = { status?: number; product?: { product_name?: string; product_name_pt?: string; brands?: string; quantity?: string } };

export async function consultarGtin(codigo: string): Promise<DadosGtin> {
  const s = await exigirSessao(PAPEIS);
  const gtin = so(codigo);
  if (gtin.length < 8 || gtin.length > 14) return { fonte: 'nenhuma', aviso: 'Código de barras deve ter de 8 a 14 dígitos.' };

  // 1) nosso catálogo
  const { data: nosso } = await supabaseAdmin().from('produtos')
    .select('nome').eq('tenant_id', s.tenantId).eq('codigo_barras', gtin).maybeSingle();
  if (nosso) return { fonte: 'catalogo', jaCadastrado: nosso.nome as string, aviso: `Este código já está cadastrado: ${nosso.nome}.` };

  // 2) Bluesoft Cosmos (nome + NCM + CEST)
  const token = process.env.COSMOS_TOKEN;
  if (token) {
    const c = (await buscarJson(`https://api.cosmos.bluesoft.com.br/gtins/${gtin}.json`, {
      'X-Cosmos-Token': token, 'User-Agent': 'Cosmos-API-Request', 'Content-Type': 'application/json',
    })) as Cosmos | null;
    if (c?.description) {
      const ncm = so(c.ncm?.code);
      const cest = so(c.cest?.code ?? undefined);
      return {
        fonte: 'cosmos',
        nome: c.description,
        marca: c.brand?.name,
        ncm: ncm.length === 8 ? ncm : undefined,
        ncmDescricao: c.ncm?.full_description ?? c.ncm?.description,
        cest: cest.length === 7 ? cest : undefined,
        ...lerConteudo(c.description),
        ...sugerirPeloNcm(ncm),
      };
    }
  }

  // 3) Open Food Facts (sem fiscal)
  const o = (await buscarJson(`https://world.openfoodfacts.org/api/v2/product/${gtin}.json?fields=product_name,product_name_pt,brands,quantity`, {
    'User-Agent': 'ADEGA-SB/1.0 (cadastro de produtos)',
  })) as Off | null;
  const nome = o?.product?.product_name_pt || o?.product?.product_name;
  if (o?.status === 1 && nome) {
    return {
      fonte: 'openfoodfacts',
      nome: [nome, o.product?.quantity].filter(Boolean).join(' '),
      marca: o.product?.brands?.split(',')[0]?.trim(),
      ...lerConteudo(o.product?.quantity ?? nome),
      aviso: token ? undefined : 'Sem NCM/CEST: ative a consulta fiscal (token do Cosmos) para trazer os dados fiscais.',
    };
  }

  return {
    fonte: 'nenhuma',
    aviso: token ? 'Código não encontrado nas bases: preencha à mão.' : 'Código não encontrado na base aberta. Com o token do Cosmos a busca encontra muito mais produtos brasileiros.',
  };
}
