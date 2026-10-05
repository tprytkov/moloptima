const MODEL_LINE = /^MODEL\s+(\d+)\s*$/;
const VINA_RESULT_LINE = /^REMARK VINA RESULT:\s+([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s*$/;
const SAFE_POSE_PATH = /^docking\/poses\/[A-Za-z0-9._-]+\.pdbqt$/i;

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseModel(modelNumber, lines) {
  const atomRecordCount = lines.filter((line) => line.startsWith('ATOM  ') || line.startsWith('HETATM')).length;
  if (!atomRecordCount) throw new Error(`Docking pose MODEL ${modelNumber} contains no atom records.`);
  const remark = lines.map((line) => VINA_RESULT_LINE.exec(line)).find(Boolean);
  if (!remark) throw new Error(`Docking pose MODEL ${modelNumber} has no valid Vina result record.`);
  return {
    modelNumber,
    text: `${lines.join('\n')}\n`,
    atomRecordCount,
    affinityKcalMol: finiteNumber(remark[1]),
    rmsdLb: finiteNumber(remark[2]),
    rmsdUb: finiteNumber(remark[3]),
  };
}

export function parseVinaPoseModels(poseText) {
  if (typeof poseText !== 'string' || !poseText.trim()) {
    throw new Error('Docking pose artifact is empty.');
  }
  const lines = poseText.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const models = [];
  let current = null;
  let currentNumber = null;
  let sawModel = false;

  lines.forEach((line) => {
    const modelMatch = MODEL_LINE.exec(line.trim());
    if (modelMatch) {
      if (current) throw new Error('Docking pose artifact contains nested MODEL records.');
      currentNumber = Number(modelMatch[1]);
      if (!Number.isInteger(currentNumber) || currentNumber < 1) {
        throw new Error('Docking pose artifact contains an invalid MODEL number.');
      }
      if (models.some((model) => model.modelNumber === currentNumber)) {
        throw new Error(`Docking pose artifact repeats MODEL ${currentNumber}.`);
      }
      sawModel = true;
      current = [line];
      return;
    }
    if (line.trim() === 'ENDMDL') {
      if (!current) throw new Error('Docking pose artifact contains ENDMDL without MODEL.');
      current.push(line);
      models.push(parseModel(currentNumber, current));
      current = null;
      currentNumber = null;
      return;
    }
    if (current) current.push(line);
  });

  if (current) throw new Error(`Docking pose MODEL ${currentNumber} is missing ENDMDL.`);
  if (sawModel) return models;
  if (lines.some((line) => line.trim() === 'ENDMDL')) {
    throw new Error('Docking pose artifact contains ENDMDL without MODEL.');
  }
  return [parseModel(1, lines.filter((line, index) => index < lines.length - 1 || line !== ''))];
}

function nearlyEqual(left, right, tolerance = 0.001) {
  return Math.abs(left - right) <= tolerance;
}

export function selectVinaPoseMode(poseModels, metadataModes, selectedMode) {
  const modeNumber = Number(selectedMode);
  if (!Number.isInteger(modeNumber) || modeNumber < 1) {
    throw new Error('Requested docking mode must be a positive integer.');
  }
  const metadata = Array.isArray(metadataModes)
    ? metadataModes.find((mode) => Number(mode.mode) === modeNumber)
    : null;
  if (!metadata) throw new Error(`Docking metadata for mode ${modeNumber} is unavailable.`);
  const poseModelNumber = Number(metadata.pose_model ?? metadata.mode);
  const pose = poseModels.find((model) => model.modelNumber === poseModelNumber);
  if (!pose) throw new Error(`Docking coordinates for mode ${modeNumber} are unavailable.`);

  const comparisons = [
    ['affinity', metadata.affinity_kcal_mol, pose.affinityKcalMol],
    ['RMSD lower bound', metadata.rmsd_lb, pose.rmsdLb],
    ['RMSD upper bound', metadata.rmsd_ub, pose.rmsdUb],
  ];
  comparisons.forEach(([label, metadataValue, poseValue]) => {
    const expected = finiteNumber(metadataValue);
    if (expected !== null && poseValue !== null && !nearlyEqual(expected, poseValue)) {
      throw new Error(`Docking ${label} for mode ${modeNumber} does not match its pose artifact.`);
    }
  });
  return { pose, metadata };
}

export function dockingPoseArtifactUrl(apiBaseUrl, jobId, poseFile) {
  if (!jobId || typeof jobId !== 'string') throw new Error('Docking job context is unavailable.');
  if (typeof poseFile !== 'string' || !SAFE_POSE_PATH.test(poseFile)) {
    throw new Error('Docking pose artifact path is invalid.');
  }
  const encodedPath = poseFile.split('/').map(encodeURIComponent).join('/');
  return `${apiBaseUrl}/api/results/${encodeURIComponent(jobId)}/artifacts/${encodedPath}`;
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 verification is unavailable in this browser.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function fetchDockingPoseArtifact(
  apiBaseUrl, jobId, poseFile, expectedSha256, signal, fetchImpl = globalThis.fetch,
) {
  const url = dockingPoseArtifactUrl(apiBaseUrl, jobId, poseFile);
  const fetchStarted = performance.now();
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`Docking pose artifact is unavailable (${response.status}).`);
  const bytes = await response.arrayBuffer();
  const fetchDurationMs = performance.now() - fetchStarted;
  if (!bytes.byteLength) throw new Error('Docking pose artifact is empty.');
  const actualSha256 = await sha256Hex(bytes);
  if (expectedSha256 && actualSha256 !== String(expectedSha256).toLowerCase()) {
    throw new Error('Docking pose artifact identity does not match result metadata.');
  }
  const poseText = new TextDecoder().decode(bytes);
  const parseStarted = performance.now();
  const models = parseVinaPoseModels(poseText);
  return {
    text: poseText,
    models,
    sha256: actualSha256,
    fetchDurationMs,
    parseDurationMs: performance.now() - parseStarted,
  };
}
