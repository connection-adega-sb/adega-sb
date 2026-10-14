// PIX "copia e cola" estático com valor (BR Code / EMV-MPM, Manual do BR Code do Banco Central).
// Gera o texto do QR no navegador: NÃO fala com banco nenhum e NÃO confirma pagamento —
// o caixa confere no app do banco e clica "PIX recebido". Sem dependência de servidor.

import { cpfValido } from '@/lib/cpf';

export type ConfigPix = { chave: string; nome: string; cidade: string };

const campo = (id: string, valor: string) => id + String(valor.length).padStart(2, '0') + valor;

// CRC16-CCITT (polinômio 0x1021, início 0xFFFF), exigido no campo 63
export function crc16(txt: string): string {
  let crc = 0xffff;
  for (let i = 0; i < txt.length; i++) {
    crc ^= txt.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// nome e cidade do recebedor: sem acento, maiúsculas, só caracteres que todo banco lê
export const textoPix = (s: string, max: number) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-]/g, ' ')
    .replace(/\s+/g, ' ').trim().toUpperCase().slice(0, max);

// Normaliza a chave e diz o tipo. null = chave inválida.
export function normalizarChave(bruta: string): { chave: string; tipo: 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria' } | null {
  const s = bruta.trim();
  if (!s) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return { chave: s.toLowerCase(), tipo: 'aleatoria' };
  if (s.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 77 ? { chave: s.toLowerCase(), tipo: 'email' } : null;
  const d = s.replace(/\D/g, '');
  if (s.startsWith('+')) return d.length >= 12 && d.length <= 13 ? { chave: '+' + d, tipo: 'telefone' } : null;
  if (d.length === 11 && !s.startsWith('(') && cpfValido(d)) return { chave: d, tipo: 'cpf' };
  if (d.length === 14) return { chave: d, tipo: 'cnpj' };
  if (d.length === 10 || d.length === 11) return { chave: '+55' + d, tipo: 'telefone' };   // (11) 98877-2244
  return null;
}

// txid: só letras e números, até 25 (estático aceita "***")
export const txidPix = (s: string) => (s.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***');

export function payloadPix(cfg: ConfigPix, valor: number | null, txid = '***'): string {
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', cfg.chave);
  let p = campo('00', '01')
    + campo('26', conta)
    + campo('52', '0000')
    + campo('53', '986');
  if (valor !== null && valor > 0) p += campo('54', valor.toFixed(2));
  p += campo('58', 'BR')
    + campo('59', cfg.nome)
    + campo('60', cfg.cidade)
    + campo('62', campo('05', txid))
    + '6304';
  return p + crc16(p);
}
