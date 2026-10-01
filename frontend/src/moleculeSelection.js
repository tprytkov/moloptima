import { MAX_BATCH_SIZE } from './jobWorkflow.js';
import { SMALL_IMPORT_FILE_THRESHOLD } from './moleculeImportWorkflow.js';

export const SUPPORTED_MOLECULE_EXTENSIONS = Object.freeze(['.csv', '.tsv', '.sdf', '.pdb']);
export const LARGE_SELECTION_THRESHOLD = 12;
export const FILE_PREVIEW_LIMIT = 5;

const SUPPORTED_EXTENSION_SET = new Set(SUPPORTED_MOLECULE_EXTENSIONS);

export function moleculeFileExtension(file) {
  const name = String(file?.name ?? '');
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '';
}

export function isSupportedMoleculeFile(file) {
  return SUPPORTED_EXTENSION_SET.has(moleculeFileExtension(file));
}

export function moleculeFileIdentity(file) {
  const relativePath = String(
    file?.webkitRelativePath || file?.relativePath || file?.path || '',
  ).replaceAll('\\', '/');
  return [relativePath, file?.name ?? '', file?.size ?? '', file?.lastModified ?? ''].join('\u0000');
}

export function mergePendingMoleculeFiles(currentFiles = [], addedFiles = []) {
  const merged = [];
  const seen = new Set();
  for (const file of [...currentFiles, ...addedFiles]) {
    const identity = moleculeFileIdentity(file);
    if (!seen.has(identity)) {
      seen.add(identity);
      merged.push(file);
    }
  }
  return merged;
}

export function classifyPendingMoleculeFiles(files = []) {
  const supported = [];
  const unsupported = [];
  for (const file of files) {
    (isSupportedMoleculeFile(file) ? supported : unsupported).push(file);
  }
  return { total: files.length, supported, unsupported };
}

export function pendingSelectionLimitError(files = [], smilesText = '') {
  const { supported } = classifyPendingMoleculeFiles(files);
  const smilesRecordCount = String(smilesText).split(/\r?\n/).filter((line) => line.trim()).length;
  if (smilesRecordCount > MAX_BATCH_SIZE) {
    return `Maximum batch size is ${MAX_BATCH_SIZE.toLocaleString()} submitted molecule records; pasted SMILES contains ${smilesRecordCount.toLocaleString()}.`;
  }
  if (supported.length > SMALL_IMPORT_FILE_THRESHOLD) return '';
  const structureFileCount = supported.filter((file) => {
    const extension = moleculeFileExtension(file);
    return extension === '.sdf' || extension === '.pdb';
  }).length;
  const knownRecordCount = structureFileCount + smilesRecordCount;
  if (knownRecordCount <= MAX_BATCH_SIZE) return '';
  return `Maximum batch size is ${MAX_BATCH_SIZE.toLocaleString()} submitted molecule records; this selection contains at least ${knownRecordCount.toLocaleString()}.`;
}

export function applyMoleculeSelectionUpdate(current, update) {
  if (update.addFiles) {
    return {
      ...current,
      selectedFiles: mergePendingMoleculeFiles(current.selectedFiles, update.addFiles),
      error: '',
    };
  }
  if (update.clearSelectedFiles) {
    return {
      ...current,
      selectedFiles: [],
      error: '',
      fileInputResetKey: Number(current.fileInputResetKey ?? 0) + 1,
    };
  }
  return { ...current, ...update };
}

export function filesForMoleculeValidation(files = []) {
  return classifyPendingMoleculeFiles(files).supported;
}
