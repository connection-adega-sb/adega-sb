// Valor por extenso em reais (recibo). Até 999.999.999,99 — suficiente para uma adega.
const U = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze',
  'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const D = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const C = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(C[c]);
  if (r < 20) { if (r) partes.push(U[r]); }
  else { partes.push(D[Math.floor(r / 10)] + (r % 10 ? ' e ' + U[r % 10] : '')); }
  return partes.join(' e ');
}

function inteiro(n: number): string {
  if (n === 0) return 'zero';
  const mi = Math.floor(n / 1_000_000), mil = Math.floor((n % 1_000_000) / 1000), r = n % 1000;
  const partes: string[] = [];
  if (mi) partes.push(mi === 1 ? 'um milhão' : ate999(mi) + ' milhões');
  if (mil) partes.push(mil === 1 ? 'mil' : ate999(mil) + ' mil');
  if (r) partes.push(ate999(r));
  if (partes.length > 1 && r && (r < 100 || r % 100 === 0)) return partes.slice(0, -1).join(' ') + ' e ' + partes[partes.length - 1];
  return partes.join(' ');
}

export function reaisPorExtenso(valor: number): string {
  const centavosTot = Math.round(valor * 100);
  const reais = Math.floor(centavosTot / 100), cent = centavosTot % 100;
  const deReais = reais >= 1_000_000 && reais % 1_000_000 === 0 ? 'de reais' : 'reais';   // "um milhão de reais"
  const r = reais ? `${inteiro(reais)} ${reais === 1 ? 'real' : deReais}` : '';
  const c = cent ? `${ate999(cent)} ${cent === 1 ? 'centavo' : 'centavos'}` : '';
  if (r && c) return `${r} e ${c}`;
  return r || c || 'zero reais';
}
