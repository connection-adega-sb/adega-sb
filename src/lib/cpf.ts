// CPF: só dígitos + dígito verificador (mesma regra da função cpf_valido da 0008). Client e server.
export const soDigitos = (t: string) => t.replace(/\D/g, '');

export function cpfValido(t: string): boolean {
  const d = soDigitos(t);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export function mascaraCpf(t: string): string {
  const d = soDigitos(t).slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}
