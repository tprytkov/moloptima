export const CHEMICAL_SPACE_TOP_K_OPTIONS = Object.freeze([5, 10, 20, 50]);

export function paddedChemicalSpaceDomain(values = []) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [-1, 1];
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  if (minimum === maximum) return [minimum - 1, maximum + 1];
  const padding = (maximum - minimum) * 0.08;
  return [minimum - padding, maximum + padding];
}

export function projectChemicalSpacePoints(points = [], width = 900, height = 520, padding = 42) {
  const xDomain = paddedChemicalSpaceDomain(points.map((point) => point.x));
  const yDomain = paddedChemicalSpaceDomain(points.map((point) => point.y));
  const scale = (value, domain, range) => range[0] + ((value - domain[0]) / (domain[1] - domain[0])) * (range[1] - range[0]);
  return points.map((point) => ({
    ...point,
    screenX: scale(point.x, xDomain, [padding, width - padding]),
    screenY: scale(point.y, yDomain, [height - padding, padding]),
  }));
}

export function searchChemicalSpacePoints(points = [], query = '') {
  const needle = String(query).trim().toLocaleLowerCase();
  if (!needle) return points;
  return points.filter((point) => [
    point.molecule_id, point.display_name, point.canonical_smiles,
    point.source_filename, point.source_record,
  ].some((value) => String(value || '').toLocaleLowerCase().includes(needle)));
}

export function categoricalPointColor(value) {
  const palette = ['#176b87', '#8f4f95', '#a95f19', '#397b44', '#805b21', '#4457a6', '#a13f5b', '#4f6f76'];
  const text = String(value || 'Unavailable');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

export function numericPointColor(value, domain) {
  if (!Number.isFinite(value)) return '#a6adb4';
  const fraction = Math.max(0, Math.min(1, (value - domain[0]) / (domain[1] - domain[0] || 1)));
  const red = Math.round(33 + fraction * 184);
  const green = Math.round(113 - fraction * 50);
  const blue = Math.round(150 - fraction * 102);
  return `rgb(${red}, ${green}, ${blue})`;
}
