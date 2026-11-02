/**
 * Swedish organisationsnummer for a legal entity: ten digits, Luhn checksum,
 * and a third digit of 2 or higher. That last rule rejects personnummer (whose
 * third and fourth digits are a month), so a sole trader's personal identity
 * number is never accepted or stored as an "organization number".
 */
export function normalizeOrganizationNumber(value: string): string | null {
  const digits = value.trim().replace(/^(16)?(\d{6})-?(\d{4})$/u, "$2$3");
  if (!/^\d{10}$/u.test(digits) || Number(digits[2]) < 2) return null;
  let sum = 0;
  for (let index = 0; index < 9; index++) {
    let product = Number(digits[index]) * (index % 2 === 0 ? 2 : 1);
    if (product > 9) product -= 9;
    sum += product;
  }
  if ((10 - (sum % 10)) % 10 !== Number(digits[9])) return null;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}
