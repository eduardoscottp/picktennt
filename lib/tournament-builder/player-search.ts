import { DomainError } from './requests';

export function requirePlayerSearchAdmin(role: string): void {
  if (role !== 'owner' && role !== 'admin') throw new DomainError('FORBIDDEN', 'Administrator permission required.');
}

export function playerSearchFilter(input: string): string {
  const query = input.trim();
  if (query.length < 3 || query.length > 80 || !/^[\p{L}\p{N}._ -]+$/u.test(query)) throw new DomainError('INVALID_REQUEST', 'Enter at least three letters or numbers.');
  const fields = ['first_name', 'last_name', 'username', 'dupr_id'];
  const filters = fields.map(field => `${field}.ilike.%${query}%`);
  const parts = query.split(/\s+/);
  if (parts.length === 2) filters.push(`and(first_name.ilike.%${parts[0]}%,last_name.ilike.%${parts[1]}%)`);
  return filters.join(',');
}
