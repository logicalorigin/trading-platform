export const normalizeAccountCurrency = (value) => {
  const currency = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
};

export const resolveCompleteAccountCurrency = (values = []) => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const currencies = values.map(normalizeAccountCurrency);
  if (currencies.some((currency) => currency == null)) return null;
  const unique = new Set(currencies);
  return unique.size === 1 ? unique.values().next().value : null;
};
