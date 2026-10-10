export function formatBlingDocument(value: string | null | undefined): string | null {
  if (value == null || value === '') return value ?? null;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return value;
}

export function formatBlingZipCode(value: string | null | undefined): string | null {
  if (value == null || value === '') return value ?? null;
  const digits = value.replace(/\D/g, '');
  return digits.length === 8 ? digits.replace(/(\d{5})(\d{3})/, '$1-$2') : value;
}

export function googleMapsSearchUrl(address: string | null | undefined): string | null {
  const query = address?.trim();
  if (!query) return null;
  const params = new URLSearchParams({ api: '1', query });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}
