export function searchBreeds(list, query, synonyms = {}, limit = 60) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return list.slice(0, 8);
  return list
    .filter(b => b.toLowerCase().includes(q) || (synonyms[b] || []).some(s => s.includes(q)))
    .slice(0, limit);
}
