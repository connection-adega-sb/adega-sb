'use server';
import { z } from 'zod';
import { exigirSessao } from '@/lib/sessao';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Cadastro de produto — usado de QUALQUER módulo de venda (PDV, bar) no meio da operação.
// Pedido do cliente 2026-10-10: "produto novo que apareceu no meio da venda".
// Toda regra fica NO SERVIDOR (0007 produto_criar): tenant vem do perfil do usuário, validação
// dos dados e saldo inicial gravado como movimento 'entrada' auditado.
// Papéis: quem opera venda precisa poder cadastrar na hora; `produtos.criado_por` guarda quem.

const UUID = z.string().uuid();
const PAPEIS_CADASTRO = ['master', 'gerente', 'caixa', 'bartender', 'estoquista'] as const;

export type ProdutoNovo = {
  id: string; codigo_barras: string | null; nome: string;
  preco_varejo: number; adulto: boolean; fumigeno: boolean;
  estoque: number; categoria: string | null;
  tipo: 'revenda' | 'preparado' | 'insumo'; unidade: string;
};

export type EstadoCadastro = { erro?: string; produto?: ProdutoNovo };

const Entrada = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do produto.'),
  tipo: z.enum(['revenda', 'preparado', 'insumo']),
  unidade: z.enum(['un', 'kg', 'l']),
  precoVarejo: z.number().nonnegative('Preço de venda inválido.'),
  codigoBarras: z.string().nullable(),
  categoriaId: z.string().nullable(),
  conteudo: z.number().positive('Conteúdo deve ser maior que zero.').nullable(),
  conteudoUnidade: z.enum(['ml', 'g', 'un']).nullable(),
  custoMedio: z.number().nonnegative('Custo médio inválido.').nullable(),
  localId: UUID,
  saldoInicial: z.number(),
  adulto: z.boolean(),
  fumigeno: z.boolean(),
});

export type Categoria = { id: string; nome: string };

export async function listarCategorias(): Promise<Categoria[]> {
  await exigirSessao(PAPEIS_CADASTRO);
  const { data } = await supabaseAdmin().from('categorias')
    .select('id, nome').eq('ativo', true).order('nome');
  return (data ?? []) as Categoria[];
}

// O cliente monta o FormData (modal com botão "Cadastrar e voltar para a venda").
export async function criarProdutoRapido(_: EstadoCadastro, form: FormData): Promise<EstadoCadastro> {
  const s = await exigirSessao(PAPEIS_CADASTRO);

  const txt = (k: string) => { const v = form.get(k); return typeof v === 'string' ? v.trim() : ''; };
  // aceita "12,50" (teclado brasileiro) e "12.50" (input type=number já normaliza com ponto)
  const numero = (k: string) => {
    const v = txt(k);
    if (v === '') return NaN;
    return Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
  };
  const opcional = (k: string) => (txt(k) === '' ? null : numero(k));

  const bruto = {
    nome: txt('nome'),
    tipo: (txt('tipo') || 'revenda') as 'revenda' | 'preparado' | 'insumo',
    unidade: (txt('unidade') || 'un') as 'un' | 'kg' | 'l',
    precoVarejo: numero('precoVarejo'),
    codigoBarras: txt('codigoBarras') || null,
    categoriaId: txt('categoriaId') || null,
    conteudo: opcional('conteudo'),
    conteudoUnidade: txt('conteudoUnidade') || null,
    custoMedio: opcional('custoMedio'),
    localId: txt('localId'),
    saldoInicial: opcional('saldoInicial') ?? 0,
    adulto: form.get('adulto') === 'on',
    fumigeno: form.get('fumigeno') === 'on',
  };
  // NaN escapa do zod (typeof NaN é "number") — trapo aqui com mensagem amigável
  if (Number.isNaN(bruto.precoVarejo)) return { erro: 'Preço de venda inválido (ex.: 12,50).' };
  if (bruto.conteudo !== null && Number.isNaN(bruto.conteudo)) return { erro: 'Conteúdo inválido (ex.: 350).' };
  if (bruto.custoMedio !== null && Number.isNaN(bruto.custoMedio)) return { erro: 'Custo médio inválido (ex.: 18,50).' };
  if (Number.isNaN(bruto.saldoInicial)) return { erro: 'Saldo inicial inválido (ex.: 10).' };

  const dados = Entrada.safeParse(bruto);
  if (!dados.success) return { erro: dados.error.issues[0]?.message ?? 'Dados inválidos.' };
  const d = dados.data;

  if (s.papel !== 'master' && !s.locais.includes(d.localId)) {
    return { erro: 'Você não tem acesso a este local.' };
  }
  if (d.fumigeno && !d.adulto) return { erro: 'Produto fumígeno exige classificação +18.' };
  if (d.saldoInicial !== 0 && d.saldoInicial < 0) return { erro: 'Saldo inicial não pode ser negativo.' };

  const sb = supabaseAdmin();
  const { data: id, error } = await sb.rpc('produto_criar', {
    p_nome: d.nome,
    p_preco_varejo: d.precoVarejo,
    p_usuario: s.id,
    p_codigo_barras: d.codigoBarras,
    p_categoria_id: d.categoriaId,
    p_tipo: d.tipo,
    p_unidade: d.unidade,
    p_conteudo: d.conteudo,
    p_conteudo_unidade: d.conteudoUnidade,
    p_adulto: d.adulto,
    p_fumigeno: d.fumigeno,
    p_custo_medio: d.custoMedio,
    p_local: d.saldoInicial === 0 ? null : d.localId,
    p_quantidade_inicial: d.saldoInicial,
  });
  if (error) return { erro: traduzErro(error.message) };

  // devolve o produto no formato que a tela de venda já usa, para entrar na comanda na hora
  const [rProd, rSaldo] = await Promise.all([
    sb.from('produtos')
      .select('id, codigo_barras, nome, preco_varejo, adulto, fumigeno, tipo, unidade, categorias(nome)')
      .eq('id', id).maybeSingle(),
    sb.from('estoque_saldos').select('quantidade').eq('produto_id', id).eq('local_id', d.localId).maybeSingle(),
  ]);
  const p = rProd.data;
  if (!p) return { erro: 'Produto criado, mas não foi possível ler de volta.' };
  const cat = p.categorias as unknown as { nome: string } | null;

  return {
    produto: {
      id: p.id, codigo_barras: p.codigo_barras, nome: p.nome,
      preco_varejo: Number(p.preco_varejo), adulto: p.adulto, fumigeno: p.fumigeno,
      estoque: Number(rSaldo.data?.quantidade ?? 0), categoria: cat?.nome ?? null,
      tipo: p.tipo as ProdutoNovo['tipo'], unidade: p.unidade,
    },
  };
}

// Mensagens amigáveis do banco (mesmo vocabulário das outras server actions).
function traduzErro(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('código de barras já cadastrado')) return 'Este código de barras já está cadastrado.';
  if (m.includes('nome do produto é obrigatório')) return 'Informe o nome do produto.';
  if (m.includes('preço de venda inválido')) return 'Preço de venda inválido.';
  if (m.includes('tipo de produto inválido')) return 'Tipo de produto inválido.';
  if (m.includes('unidade de venda inválida')) return 'Unidade de venda inválida.';
  if (m.includes('unidade de conteúdo inválida')) return 'Unidade de conteúdo inválida.';
  if (m.includes('informe o conteúdo')) return 'Informe o conteúdo da embalagem.';
  if (m.includes('fumígeno exige')) return 'Produto fumígeno exige classificação +18.';
  if (m.includes('categoria não encontrada')) return 'Categoria inválida.';
  if (m.includes('informe o local')) return 'Informe o local para o saldo inicial.';
  if (m.includes('saldo inicial não pode ser negativo')) return 'Saldo inicial não pode ser negativo.';
  if (m.includes('local não encontrado')) return 'Local inválido para este cadastro.';
  if (m.includes('usuário sem perfil ativo')) return 'Sessão inválida: recarregue a página e entre de novo.';
  if (m.includes('duplicate key') || m.includes('unique constraint')) return 'Já existe um produto com estes dados.';
  return msg;
}
