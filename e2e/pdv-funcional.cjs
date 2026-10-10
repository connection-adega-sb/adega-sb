// E2E funcional do PDV (leitor + comanda ao vivo) — DIFERENTE do gate acesso-gate:
// roda contra o STAGING de verdade (login real, venda real, baixa real de estoque).
// Uso: npm run build && npm run e2e:pdv   (fora do CI: precisa do .env.local com chaves reais)
// Cria/atualiza o usuário de teste caixa.e2e@adega-sb.invalid (senha nova a cada execução)
// e exige o seed 0003 aplicado (28 produtos + Caixa #01 na loja).
const { spawn, execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const RAIZ = path.join(__dirname, '..');
const PORTA = 3103;
const BASE = `http://127.0.0.1:${PORTA}`;
const EMAIL = 'caixa.e2e@adega-sb.invalid';
const NOME = 'Caixa E2E';
const SENHA = 'Ad' + randomBytes(8).toString('hex') + '!7q'; // troca a cada execução (staging only)
let ok = 0, falha = 0;

const check = async (id, nome, fn) => {
  try { const r = await fn(); if (r === false) throw new Error('falso'); ok++; console.log('PASS', id, nome); }
  catch (e) { falha++; console.log('FAIL', id, nome, '—', String(e.message).split('\n')[0]); }
};

// ---------------------------------------------------------------- env (.env.local do staging)
function carregarEnv() {
  const env = { ...process.env };
  const arq = path.join(RAIZ, '.env.local');
  if (fs.existsSync(arq)) {
    for (const l of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}
const env = carregarEnv();
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) {
  if (!env[k]) { console.error(`Falta ${k}: rode esta suíte no staging com .env.local completo.`); process.exit(1); }
}

// ---------------------------------------------------------------- banco (admin)
const adm = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

async function garantirUsuario() {
  const { data: t, error: et } = await adm.from('tenants').select('id').eq('cnpj', '43.466.024/0001-43').single();
  if (et) throw new Error('tenant ADEGA SB não encontrado (0001 aplicada?): ' + et.message);
  const { data: loja, error: el } = await adm.from('locais').select('id').eq('tenant_id', t.id).eq('codigo', 'loja').single();
  if (el || !loja) throw new Error("local 'loja' não encontrado");

  let usuarios = [], pagina = 1;
  for (;;) {
    const { data, error } = await adm.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error) throw error;
    usuarios = usuarios.concat(data.users);
    if (data.users.length < 200 || pagina > 10) break;
    pagina++;
  }
  const existe = usuarios.find((u) => (u.email ?? '').toLowerCase() === EMAIL);
  let uid;
  if (existe) {
    const { error: eUp } = await adm.auth.admin.updateUserById(existe.id, { password: SENHA, email_confirm: true });
    if (eUp) throw eUp;
    uid = existe.id;
  } else {
    const { data: novo, error: eCriar } = await adm.auth.admin.createUser({ email: EMAIL, password: SENHA, email_confirm: true });
    if (eCriar) throw eCriar;
    uid = novo.user.id;
  }
  const { error: ePerfil } = await adm.from('profiles').upsert(
    { id: uid, tenant_id: t.id, nome: NOME, role: 'caixa', ativo: true, deve_trocar_senha: false },
    { onConflict: 'id' });
  if (ePerfil) throw ePerfil;
  // vínculo com a loja (sem ele listarCaixas devolve [] para papel caixa)
  await adm.from('profile_locais').delete().eq('profile_id', uid);
  const { error: eVinc } = await adm.from('profile_locais').insert({ profile_id: uid, local_id: loja.id, tenant_id: t.id });
  if (eVinc) throw eVinc;
  return { lojaId: loja.id };
}

async function conferirSeed() {
  const { data: caixas } = await adm.from('caixas').select('id').eq('ativo', true);
  const { data: p } = await adm.from('produtos').select('id').eq('codigo_barras', '7898107').eq('ativo', true).maybeSingle();
  if (!caixas?.length || !p) throw new Error('seed 0003 ausente — aplique supabase/seed/0003_seed_catalogo_exemplo.sql no staging');
}

async function estoque(localId, codigo) {
  const { data: p } = await adm.from('produtos').select('id').eq('codigo_barras', codigo).single();
  const { data: s } = await adm.from('estoque_saldos').select('quantidade').eq('produto_id', p.id).eq('local_id', localId).maybeSingle();
  return Number(s?.quantidade ?? 0);
}

// ---------------------------------------------------------------- servidor (build + next start)
function subirServidor() {
  const proximo = path.join(RAIZ, 'node_modules/next/dist/bin/next');
  console.log('=== build (.next, com .env.local) — sempre rebuild para testar o código atual');
  execFileSync(process.execPath, [proximo, 'build'], { cwd: RAIZ, env, stdio: ['ignore', 'inherit', 'inherit'] });
  const p = spawn(process.execPath, [proximo, 'start', '-p', String(PORTA)], { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((ok_, erro) => {
    const t = setTimeout(() => erro(new Error('servidor não subiu em 40 s (porta 3103 ocupada?)')), 40000);
    p.stdout.on('data', (b) => { if (/Ready|started server|Local:/i.test(String(b))) { clearTimeout(t); setTimeout(() => ok_(p), 300); } });
    p.on('exit', (c) => { clearTimeout(t); erro(new Error('next start saiu com código ' + c)); });
  });
}

// ---------------------------------------------------------------- helpers de tela
const status = async (pg) => (await pg.getByTestId('pdv-status').innerText()).includes('ABERTO') ? 'ABERTO' : 'FECHADO';
const paraReal = (txt) => {
  const m = txt.match(/R\$\s*([\d.]+,\d{2})/);
  if (!m) throw new Error('valor não encontrado em: ' + txt.slice(0, 80));
  return Number(m[1].replace(/\./g, '').replace(',', '.'));
};
// pt-BR formata BRL com espaço inquebrável (U+00A0) — normaliza antes de comparar texto
const limpa = (t) => String(t).replace(/[\u00A0\u202F]/g, ' ');
async function entrar(pg) {
  await pg.goto(BASE + '/login?next=/pdv');
  await pg.getByTestId('login-email').fill(EMAIL);
  await pg.getByTestId('login-senha').fill(SENHA);
  await pg.getByTestId('login-entrar').click();
  await pg.waitForURL('**/pdv', { timeout: 20000 });
  await pg.getByTestId('pdv-status').waitFor({ timeout: 15000 });
}
async function abrirCaixa(pg, valor) {
  await pg.getByTestId('pdv-abrir-caixa-btn').click();
  await pg.getByTestId('pdv-valor-abertura').fill(String(valor));
  await pg.getByTestId('pdv-abrir-submit').click();
  await pg.waitForFunction(() => {
    const el = document.querySelector('[data-testid="pdv-status"]');
    return !!el && el.textContent.includes('ABERTO');
  }, undefined, { timeout: 15000 });
  await fecharPainel(pg); // painel fica aberto após abrir — Esc libera a tela
}
async function fecharPainel(pg) {
  await pg.keyboard.press('Escape');
  await pg.getByTestId('pdv-painel').waitFor({ state: 'detached', timeout: 5000 });
}
// fecha o caixa com o valor EXATO esperado (contado = esperado → "Caixa confere.")
async function fecharCaixa(pg) {
  await pg.keyboard.press('F8');                      // funciona também no mobile (comanda escondida)
  await pg.getByTestId('pdv-painel').waitFor({ timeout: 5000 });
  await pg.getByTestId('pdv-aba-fechar').click();
  const txt = await pg.getByText(/Esperado na gaveta/).innerText();
  await pg.getByTestId('pdv-valor-contado').fill(String(paraReal(txt)));
  await pg.getByTestId('pdv-fechar-submit').click();
  await pg.getByTestId('pdv-resultado-fechamento').waitFor({ timeout: 15000 });
  const resultado = (await pg.getByTestId('pdv-resultado-fechamento').innerText()).trim();
  await pg.getByTestId('pdv-resultado-ok').click();
  await pg.waitForFunction(() => {
    const el = document.querySelector('[data-testid="pdv-status"]');
    return !!el && el.textContent.includes('FECHADO');
  }, undefined, { timeout: 15000 });
  return resultado;
}
const qtdLinhas = (pg) => pg.locator('[data-testid^="pdv-item-"]').count();
const qtds = (pg) => pg.getByTestId('pdv-qtd').allInnerTexts();
const aviso = (pg) => pg.getByTestId('pdv-aviso').innerText();
const digitar = (pg, t) => pg.getByTestId('pdv-busca').pressSequentially(t, { delay: 40 });
// o Enter busca no servidor (staging remoto, ~500 ms) — sempre esperar a comanda refletir
const esperaQtd = (pg, n) => pg.waitForFunction((esperado) =>
  [...document.querySelectorAll('[data-testid="pdv-qtd"]')].some((el) => el.textContent.trim() === String(esperado)),
  n, { timeout: 15000 });
const esperaLinhas = (pg, n) => pg.waitForFunction((esperado) =>
  document.querySelectorAll('[data-testid^="pdv-item-"]').length === esperado, n, { timeout: 15000 });

let browser = null, srv = null;
(async () => {
  try {
    const { lojaId } = await garantirUsuario();
    await conferirSeed();
    browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
    srv = await subirServidor();
    const pg = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    pg.on('pageerror', (e) => console.log('  [pageerror]', e.message));
    pg.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 300)); });

    // ------------------------------------------------ 1) login e estado inicial
    await entrar(pg);
    await check('P1', 'login como caixa.e2e e entra no /pdv', async () =>
      (await pg.getByTestId('pdv-operador').innerText()).includes(NOME));
    let abertaAntes = (await status(pg)) === 'ABERTO';
    if (abertaAntes) console.log('  (sessão aberta de execução anterior — fechando para normalizar: ' + await fecharCaixa(pg) + ')');
    await check('P2', 'estado inicial normalizado (caixa fechado)', async () => (await status(pg)) === 'FECHADO');

    // ------------------------------------------------ 2) abrir caixa (CX-01/CX-02)
    await pg.getByTestId('pdv-abrir-caixa-btn').click();
    await check('P3', 'form de abertura mostra "Abrir caixa como Caixa E2E"', async () => {
      const rotulo = (await pg.getByTestId('pdv-abrir-submit').innerText()).trim();
      return rotulo.includes('Abrir caixa como') && rotulo.includes(NOME);
    });
    await pg.getByTestId('pdv-valor-abertura').fill('200');
    await pg.getByTestId('pdv-abrir-submit').click();
    await pg.waitForFunction(() => document.querySelector('[data-testid="pdv-status"]')?.textContent.includes('ABERTO'), undefined, { timeout: 15000 });
    await fecharPainel(pg);
    await check('P4', 'caixa ABERTO, painel liberado e busca habilitada', async () =>
      (await status(pg)) === 'ABERTO' && !(await pg.getByTestId('pdv-busca').isDisabled()));

    // ------------------------------------------------ 3) leitor + comanda
    await check('P5', 'F12 com comanda vazia → aviso "Comanda vazia."', async () => {
      await pg.keyboard.press('F12');
      await pg.getByTestId('pdv-aviso').waitFor({ timeout: 5000 });
      return (await aviso(pg)).includes('Comanda vazia.');
    });
    await digitar(pg, '7898107'); await pg.getByTestId('pdv-busca').press('Enter');
    await check('P6', 'leitor entra 1 unidade e limpa a busca (PDV-03)', async () => {
      await pg.getByTestId('pdv-comanda').getByText('Cerveja Pilsen Lata 350 ml').waitFor({ timeout: 5000 });
      return (await qtdLinhas(pg)) === 1 && (await qtds(pg))[0] === '1' && (await pg.getByTestId('pdv-busca').inputValue()) === '';
    });
    await digitar(pg, '7898107'); await pg.getByTestId('pdv-busca').press('Enter');
    await esperaQtd(pg, 2);
    await check('P7', 'mesmo produto soma na MESMA linha → qtd 2 (PDV-07)', async () =>
      (await qtdLinhas(pg)) === 1 && (await qtds(pg))[0] === '2');
    await digitar(pg, '3*7898107'); await pg.getByTestId('pdv-busca').press('Enter');
    await esperaQtd(pg, 5);
    await check('P8', 'multiplicador 3*7898107 → qtd 5 (PDV-04)', async () =>
      (await qtdLinhas(pg)) === 1 && (await qtds(pg))[0] === '5');
    await pg.getByTestId('pdv-desconto').fill('5');
    await check('P9', 'desconto R$ 5 → total 22,45 − 5 = R$ 17,45 (PDV-10)', async () =>
      limpa(await pg.getByTestId('pdv-total').innerText()).trim() === 'R$ 17,45');

    // ------------------------------------------------ 4) busca e atalhos
    await pg.getByTestId('pdv-busca').fill('pilsen');
    await pg.getByTestId('pdv-resultados').waitFor({ timeout: 8000 });
    await check('P10', 'busca por nome ≥2 resultados; Esc limpa (PDV-01/02/05)', async () => {
      const n = await pg.locator('[data-testid^="pdv-res-"]').count();
      await pg.keyboard.press('Escape');
      await pg.getByTestId('pdv-vazio').waitFor({ timeout: 5000 });
      return n >= 2;
    });
    await check('P11', 'F2 devolve o foco para a busca (PDV-05)', async () => {
      await pg.getByTestId('pdv-operador').click();   // tira o foco da busca
      await pg.keyboard.press('F2');
      return pg.getByTestId('pdv-busca').evaluate((el) => document.activeElement === el);
    });
    await pg.getByTestId('pdv-busca').fill('7898104');
    await pg.getByTestId('pdv-resultados').waitFor({ timeout: 8000 });
    await check('P12', 'estoque ≤5 mostra aviso "baixo" (PDV-09)', async () =>
      (await pg.locator('[data-testid="pdv-res-0"]').innerText()).includes('baixo'));
    await pg.keyboard.press('Escape');

    // ------------------------------------------------ 5) validações de venda (FV)
    await digitar(pg, '10*7898104'); await pg.getByTestId('pdv-busca').press('Enter');
    await esperaLinhas(pg, 2);
    await check('P13', 'comanda com 2 linhas (cerveja 5 + rosé 10)', async () => (await qtdLinhas(pg)) === 2);
    await pg.getByTestId('pdv-maior18').getByRole('checkbox').check();
    await pg.keyboard.press('F12');
    await pg.getByTestId('pdv-aviso').filter({ hasText: 'Estoque insuficiente' }).waitFor({ timeout: 20000 });
    await check('P14', 'servidor recusa estoque negativo e mantém a comanda (FV-03)', async () =>
      (await qtdLinhas(pg)) === 2 && (await aviso(pg)).includes('Estoque insuficiente'));
    await pg.getByTestId('pdv-maior18').getByRole('checkbox').uncheck();
    await pg.keyboard.press('F12');
    await pg.getByTestId('pdv-aviso').filter({ hasText: '+18' }).waitFor({ timeout: 8000 });
    await check('P15', 'item +18 sem confirmação → recusa do cliente (DL-12)', async () =>
      (await qtdLinhas(pg)) === 2 && (await aviso(pg)).includes('maior de 18 anos'));
    await pg.getByTestId('pdv-limpar').click();
    await check('P16', 'Limpar zera comanda, desconto e aviso', async () => {
      await pg.getByTestId('pdv-comanda').getByText('Nenhum item ainda.').waitFor({ timeout: 5000 });
      return (await qtdLinhas(pg)) === 0 && limpa(await pg.getByTestId('pdv-total').innerText()).trim() === 'R$ 0,00'
        && (await pg.getByTestId('pdv-aviso').count()) === 0;
    });

    // ------------------------------------------------ 6) venda de verdade (FV-01..04)
    const estoqueAntes = await estoque(lojaId, '7898107');
    await digitar(pg, '7898107'); await pg.getByTestId('pdv-busca').press('Enter');
    await esperaQtd(pg, 1);
    await pg.getByTestId('pdv-maior18').getByRole('checkbox').check();
    await pg.keyboard.press('F12');
    // se não vier "Venda finalizada", diz POR QUÊ (sem aviso = a promise do finalizar rejeitou)
    try {
      await pg.getByTestId('pdv-aviso').filter({ hasText: 'Venda finalizada' }).waitFor({ timeout: 20000 });
    } catch {
      const tem = await pg.getByTestId('pdv-aviso').count();
      throw new Error('P17 sem "Venda finalizada" — aviso na tela: '
        + (tem ? limpa(await aviso(pg)) : '(nenhum: finalizar não retornou)'));
    }
    await check('P17', 'venda finalizada: aviso "R$ 4,49 no PIX" e comanda zerada (FV-04)', async () =>
      limpa(await aviso(pg)).includes('Venda finalizada: R$ 4,49 no PIX') && (await qtdLinhas(pg)) === 0);

    await check('P18', 'banco: baixa de estoque −1, venda origem pdv/canal varejo, 1 item e movimento de saída (FV-03)', async () => {
      const depois = await estoque(lojaId, '7898107');
      if (depois !== estoqueAntes - 1) throw new Error(`estoque ${depois} ≠ ${estoqueAntes - 1}`);
      const { data: sess } = await adm.from('caixa_sessoes').select('id').eq('status', 'aberta')
        .order('aberta_em', { ascending: false }).limit(1).single();
      const { data: vendas } = await adm.from('vendas')
        .select('id, origem, canal, forma_pagamento, maior18, caixa_sessao_id, total, subtotal, desconto')
        .eq('caixa_sessao_id', sess.id);
      if (vendas?.length !== 1) throw new Error(`vendas na sessão = ${vendas?.length} (esperado 1)`);
      const v = vendas[0];
      if (v.origem !== 'pdv' || v.canal !== 'varejo' || v.forma_pagamento !== 'pix' || v.maior18 !== true) {
        throw new Error(`campos errados: ${JSON.stringify(v)}`);
      }
      if (Number(v.total) !== 4.49 || Number(v.subtotal) !== 4.49 || Number(v.desconto) !== 0) {
        throw new Error(`valores errados: total ${v.total} subtotal ${v.subtotal} desc ${v.desconto}`);
      }
      const { data: itens } = await adm.from('venda_itens').select('id, quantidade, preco_unit').eq('venda_id', v.id);
      if (itens?.length !== 1 || Number(itens[0].quantidade) !== 1) throw new Error('venda_itens ≠ 1 unidade');
      const { data: movs } = await adm.from('estoque_movimentos')
        .select('id, quantidade, motivo, origem_tipo, origem_id').eq('origem_id', v.id).eq('origem_tipo', 'venda');
      if (movs?.length !== 1 || Number(movs[0].quantidade) !== -1) throw new Error('movimento de saída da venda ≠ -1');
      return true;
    });

    // ------------------------------------------------ 7) painel do caixa (CX-03..09)
    await pg.keyboard.press('F8');
    await pg.getByTestId('pdv-painel').waitFor({ timeout: 5000 });
    // o recarregar pós-venda pode ainda estar em voo quando o painel abre — esperar o resumo refletir a venda
    await pg.waitForFunction(() => (document.querySelector('[data-testid="pdv-painel"]')?.textContent ?? '')
      .replace(/[\u00A0\u202F]/g, ' ').includes('1 · R$ 4,49'), undefined, { timeout: 15000 });
    await check('P19', 'resumo: 1 venda · R$ 4,49, gaveta R$ 200,00 (CX-06)', async () => {
      const t = limpa(await pg.getByTestId('pdv-painel').innerText());
      const bate = t.includes('1 · R$ 4,49') && t.includes('Gaveta') && t.includes('R$ 200,00');
      if (!bate) console.log('  [P19 painel]', JSON.stringify(t.slice(0, 400)));
      return bate;
    });
    await pg.getByTestId('pdv-aba-mov').click();   // aba pode ter ficado em "fechar" da normalização
    await pg.getByTestId('pdv-mov-valor').fill('999999');
    await pg.getByTestId('pdv-mov-motivo').fill('teto da gaveta');
    await pg.getByTestId('pdv-mov-submit').click();
    await pg.getByTestId('pdv-form-mov').getByText(/gaveta tem só/).waitFor({ timeout: 15000 });
    await check('P20', 'sangria acima do esperado → "A gaveta tem só R$ 200.00" (CX-05)', async () =>
      (await pg.getByTestId('pdv-form-mov').innerText()).includes('gaveta tem só R$ 200.00'));
    await pg.getByTestId('pdv-mov-valor').fill('10');
    await pg.getByTestId('pdv-mov-motivo').fill('teste e2e');
    await pg.getByTestId('pdv-mov-submit').click();
    await pg.getByTestId('pdv-mov-lista').getByText('sangria · teste e2e').waitFor({ timeout: 15000 });
    await check('P21', 'sangria válida entra na lista e gaveta vira R$ 190,00 (CX-03/06)', async () => {
      const t = limpa(await pg.getByTestId('pdv-painel').innerText());
      return t.includes('sangria · teste e2e') && t.includes('R$ 10,00') && t.includes('R$ 190,00');
    });
    await pg.getByTestId('pdv-aba-fechar').click();
    const txtEsp = await pg.getByText(/Esperado na gaveta/).innerText();
    await pg.getByTestId('pdv-valor-contado').fill(String(paraReal(txtEsp)));
    await pg.getByTestId('pdv-fechar-submit').click();
    await pg.getByTestId('pdv-resultado-fechamento').waitFor({ timeout: 15000 });
    await check('P22', 'fechar com contado = esperado → "Caixa confere." (CX-07)', async () =>
      (await pg.getByTestId('pdv-resultado-fechamento').innerText()).trim() === 'Caixa confere.');
    await pg.getByTestId('pdv-resultado-ok').click();
    await pg.waitForFunction(() => document.querySelector('[data-testid="pdv-status"]')?.textContent.includes('FECHADO'), undefined, { timeout: 15000 });
    await check('P23', 'sessão gravada fechada com esperado = contado = 190 e diferença 0', async () => {
      const { data: sess } = await adm.from('caixa_sessoes')
        .select('status, valor_esperado, valor_contado, diferenca').eq('status', 'fechada')
        .order('fechada_em', { ascending: false }).limit(1).single();
      return sess.status === 'fechada' && Number(sess.valor_esperado) === 190
        && Number(sess.valor_contado) === 190 && Number(sess.diferenca) === 0;
    });
    await pg.close();

    // ------------------------------------------------ 8) mobile 390 px: comanda vira drawer (PDV-07 layout)
    const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await entrar(m);
    await check('P24', 'mobile: comanda fora do fluxo e barra inferior diz "Abrir caixa"', async () =>
      !(await m.getByTestId('pdv-comanda-area').isVisible())
      && (await m.getByTestId('pdv-barra-mobile').isVisible())
      && (await m.getByTestId('pdv-barra-mobile').innerText()).trim() === 'Abrir caixa');
    await abrirCaixa(m, 200);   // vazio-state → painel → 200 → Esc
    await digitar(m, '7898107'); await m.getByTestId('pdv-busca').press('Enter');
    await m.waitForFunction(() => (document.querySelector('[data-testid="pdv-barra-mobile"]')?.textContent ?? '')
      .replace(/[\u00A0\u202F]/g, ' ').includes('1 itens · R$ 4,49'), undefined, { timeout: 15000 });
    await check('P25', 'mobile: leitor soma item e a barra mostra 1 itens · R$ 4,49', async () =>
      limpa(await m.getByTestId('pdv-barra-mobile').innerText()).includes('1 itens · R$ 4,49'));
    await m.getByTestId('pdv-barra-mobile').click();           // abre drawer
    await m.getByTestId('pdv-drawer-fechar').waitFor({ timeout: 5000 });
    await check('P26', 'mobile: drawer abre com a comanda e fecha pelo botão', async () => {
      const visivel = (await m.getByTestId('pdv-comanda-area').isVisible())
        && (await m.getByTestId('pdv-comanda').innerText()).includes('Cerveja Pilsen Lata');
      await m.getByTestId('pdv-drawer-fechar').click();
      await m.getByTestId('pdv-drawer-fechar').waitFor({ state: 'detached', timeout: 5000 });
      return visivel;
    });
    const resumoM = limpa(await fecharCaixa(m));   // vendeu nada no mobile → esperado = abertura = 200
    await check('P27', 'mobile: fecha caixa com contado = esperado → "Caixa confere." e estado final FECHADO', async () =>
      resumoM === 'Caixa confere.' && (await status(m)) === 'FECHADO');
    await m.close();

    // ------------------------------------------------ 9) login sem next + cadastro de produto NO MEIO da venda
    // contexto separado: sem cookies, para provar que o login em si cai no módulo do papel
    const ctx9 = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const p9 = await ctx9.newPage();
    p9.on('pageerror', (e) => console.log('  [pageerror]', e.message));

    await p9.goto(BASE + '/login');
    await check('P28', 'login SEM next → entra direto no /pdv (rota inicial por papel)', async () => {
      await p9.getByTestId('login-email').fill(EMAIL);
      await p9.getByTestId('login-senha').fill(SENHA);
      await p9.getByTestId('login-entrar').click();
      await p9.waitForURL('**/pdv', { timeout: 20000 });
      await p9.getByTestId('pdv-status').waitFor({ timeout: 15000 });
      return true;
    });

    await abrirCaixa(p9, 200);
    const codigoNovo = '789' + String(Date.now());
    const nomeNovo = 'Produto Cadastro Rapido ' + String(Date.now()).slice(-6);

    await check('P29', 'busca sem resultado oferece cadastro e o modal já vem com o código lido', async () => {
      await p9.getByTestId('pdv-busca').fill(codigoNovo);
      await p9.getByTestId('pdv-nao-achou').waitFor({ timeout: 10000 });
      await p9.getByTestId('pdv-cadastrar-achado').click();
      await p9.getByTestId('cadastro-modal').waitFor({ timeout: 5000 });
      const ean = await p9.getByTestId('cadastro-ean').inputValue();
      await p9.getByTestId('cadastro-fechar').click();
      await p9.getByTestId('cadastro-modal').waitFor({ state: 'detached', timeout: 5000 });
      // o mesmo modal aberto pelo botão direto, sem nada preenchido
      await p9.getByTestId('pdv-novo-produto').click();
      await p9.getByTestId('cadastro-modal').waitFor({ timeout: 5000 });
      const eanVazio = await p9.getByTestId('cadastro-ean').inputValue();
      await p9.getByTestId('cadastro-fechar').click();
      await p9.getByTestId('cadastro-modal').waitFor({ state: 'detached', timeout: 5000 });
      return ean === codigoNovo && eanVazio === '';
    });

    await p9.getByTestId('pdv-novo-produto').click();
    await p9.getByTestId('cadastro-modal').waitFor({ timeout: 5000 });
    await p9.getByTestId('cadastro-nome').fill(nomeNovo);
    await p9.getByTestId('cadastro-ean').fill(codigoNovo);
    await p9.getByTestId('cadastro-preco').fill('7,90');
    await p9.getByTestId('cadastro-saldo').fill('12');

    await check('P30', 'cadastrar → modal fecha e o produto ENTRA NA COMANDA sozinho (venda continua)', async () => {
      await p9.getByTestId('cadastro-submit').click();
      await p9.getByTestId('cadastro-modal').waitFor({ state: 'detached', timeout: 20000 });
      // exact: o aviso de sucesso embaixo cita o mesmo nome (modo estrito pegaria os dois)
      await p9.getByTestId('pdv-comanda').getByText(nomeNovo, { exact: true }).waitFor({ timeout: 15000 });
      return (await qtdLinhas(p9)) === 1;
    });

    await check('P31', 'banco: produto novo com criado_por, saldo 12 no local e ENTRADA auditada (0007)', async () => {
      const { data: prod } = await adm.from('produtos')
        .select('id, nome, criado_por, preco_varejo, codigo_barras, ativo, tipo')
        .eq('codigo_barras', codigoNovo).maybeSingle();
      if (!prod) throw new Error('produto não encontrado no banco');
      if (!prod.criado_por) throw new Error('criado_por vazio — quem cadastrou ficou perdido');
      if (prod.nome !== nomeNovo || Number(prod.preco_varejo) !== 7.9 || prod.tipo !== 'revenda') {
        throw new Error('campos errados: ' + JSON.stringify(prod));
      }
      const { data: sal } = await adm.from('estoque_saldos')
        .select('quantidade').eq('produto_id', prod.id).eq('local_id', lojaId).maybeSingle();
      if (Number(sal?.quantidade) !== 12) throw new Error('saldo = ' + sal?.quantidade + ' (esperado 12)');
      const { data: movs } = await adm.from('estoque_movimentos')
        .select('tipo, quantidade, motivo, origem_tipo, local_id').eq('produto_id', prod.id);
      if (movs?.length !== 1 || movs[0].tipo !== 'entrada' || Number(movs[0].quantidade) !== 12
        || movs[0].origem_tipo !== 'cadastro' || movs[0].local_id !== lojaId) {
        throw new Error('movimento: ' + JSON.stringify(movs));
      }
      return true;
    });

    await check('P32', 'finaliza a venda com o produto novo e a comanda volta a zero', async () => {
      await p9.keyboard.press('F12');
      await p9.getByTestId('pdv-aviso').filter({ hasText: 'Venda finalizada' }).waitFor({ timeout: 20000 });
      const a = limpa(await aviso(p9));
      if (!a.includes('Venda finalizada: R$ 7,90 no PIX')) throw new Error('aviso: ' + a);
      if ((await qtdLinhas(p9)) !== 0) throw new Error('comanda não zerou');
      const { data: movs } = await adm.from('estoque_movimentos')
        .select('tipo, quantidade').eq('origem_tipo', 'venda').order('criado_em', { ascending: false }).limit(1);
      if (movs?.[0]?.tipo !== 'saida_venda' || Number(movs[0].quantidade) !== -1) {
        throw new Error('último movimento: ' + JSON.stringify(movs));
      }
      return true;
    });
    try { await fecharCaixa(p9); } catch (e) { console.log('  (aviso: não consegui fechar o caixa do P32: ' + e.message + ')'); }

    // Limpeza: o produto criado aqui fica com movimento de estoque (append-only), então não dá
    // para apagar — desativa para não poluir o catálogo de demonstração do staging.
    // Venda e movimentos permanecem: são dados reais de auditoria.
    const { error: eLimpa } = await adm.from('produtos').update({ ativo: false }).eq('codigo_barras', codigoNovo);
    if (eLimpa) console.log('  (aviso: não consegui desativar o produto de teste: ' + eLimpa.message + ')');
    else console.log('  (produto de teste desativado do catálogo: ' + nomeNovo + ')');
    await ctx9.close();

    console.log(`TOTAL: ${ok + falha} checks · ${ok} PASS · ${falha} FAIL`);
    if (falha) process.exitCode = 1;
  } catch (e) {
    console.error('ERRO', e && e.message ? e.message : JSON.stringify(e));
    process.exitCode = 2;
  } finally {
    if (srv) srv.kill();
    if (browser) await browser.close().catch(() => {});
  }
})();
