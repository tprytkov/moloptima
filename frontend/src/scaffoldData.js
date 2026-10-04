import { ADMET_ENDPOINT_REGISTRY } from './admetAnalysisData.js';
import { categoricalPointColor } from './chemicalSpaceData.js';

export const SCAFFOLD_PAGE_SIZE = 25;
export const SCAFFOLD_COLOR_LIMIT = 12;
export const OTHER_SCAFFOLDS_KEY = 'other_scaffolds';

export function searchScaffolds(scaffolds = [], query = '') {
  const needle = String(query || '').trim().toLocaleLowerCase();
  if (!needle) return scaffolds;
  return scaffolds.filter((group) => [group.scaffold_id, group.scaffold_smiles, group.label]
    .some((value) => String(value || '').toLocaleLowerCase().includes(needle)));
}

export function paginateScaffolds(scaffolds = [], page = 0, pageSize = SCAFFOLD_PAGE_SIZE) {
  const size = Math.max(1, Math.min(100, Number(pageSize) || SCAFFOLD_PAGE_SIZE));
  const maxPage = Math.max(0, Math.ceil(scaffolds.length / size) - 1);
  const safePage = Math.min(Math.max(0, Number(page) || 0), maxPage);
  return { rows: scaffolds.slice(safePage * size, (safePage + 1) * size), page: safePage, pageSize: size, total: scaffolds.length, pageCount: maxPage + 1 };
}

export function scaffoldMembership(scaffolds = []) {
  const index = new Map();
  for (const group of scaffolds) {
    for (const member of group.members || []) index.set(member.molecule_id, group.scaffold_id);
  }
  return index;
}

export function scaffoldColorPlan(scaffolds = [], limit = SCAFFOLD_COLOR_LIMIT) {
  const visible = scaffolds.filter((group) => group.category !== 'no_ring').slice(0, limit);
  const topIds = new Set(visible.map((group) => group.scaffold_id));
  return {
    topIds,
    legend: [
      ...visible.map((group) => ({ key: group.scaffold_id, label: group.scaffold_id, color: categoricalPointColor(group.scaffold_id) })),
      ...(scaffolds.some((group) => group.category !== 'no_ring' && !topIds.has(group.scaffold_id))
        ? [{ key: OTHER_SCAFFOLDS_KEY, label: 'Other scaffolds', color: '#9aa4ad' }] : []),
      ...(scaffolds.some((group) => group.category === 'no_ring')
        ? [{ key: 'scf_no_ring', label: 'No ring scaffold', color: '#6b7280' }] : []),
    ],
  };
}

export function scaffoldPointColor(scaffoldId, plan) {
  if (scaffoldId === 'scf_no_ring') return '#6b7280';
  if (!scaffoldId || !plan?.topIds?.has(scaffoldId)) return '#9aa4ad';
  return categoricalPointColor(scaffoldId);
}

function percentileMedian(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeScaffoldAdmet(group, admetById) {
  const memberIds = (group?.members || []).map((member) => member.molecule_id);
  return ADMET_ENDPOINT_REGISTRY.map((endpoint) => {
    const properties = memberIds.map((id) => admetById.get(id)?.properties?.[endpoint.key]).filter(Boolean);
    if (endpoint.valueType === 'regression') {
      const values = properties.filter((property) => property.status?.code === 'available' && Number.isFinite(property.value)).map((property) => property.value);
      return {
        ...endpoint, availableCount: values.length, unavailableCount: memberIds.length - values.length,
        statistics: values.length ? { n: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length, median: percentileMedian(values), min: Math.min(...values), max: Math.max(...values) } : null,
      };
    }
    const classifications = properties.filter((property) => property.status?.code === 'available' && property.classification).map((property) => property.classification);
    const classCounts = classifications.reduce((counts, value) => ({ ...counts, [value]: (counts[value] || 0) + 1 }), {});
    return { ...endpoint, availableCount: classifications.length, unavailableCount: memberIds.length - classifications.length, classCounts };
  });
}
