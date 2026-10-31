export const MANUAL_SECTION_BY_TOPIC = Object.freeze({
  'getting-started': 'getting-started',
  'scientific-workflow': 'moloptima-scientific-workflow',
  molecules: 'molecules',
  'receptor-docking': 'receptor-and-docking',
  admet: 'admet-prediction',
  'chemical-space': 'chemical-space',
  'design-logic': 'design-logic',
  prioritization: 'prioritization',
  results: 'results',
  analysis: 'analysis',
  'experimental-data': 'experimental-data',
  settings: 'settings-and-scientific-runtime',
  'scientific-concepts': 'interpretation-guidelines',
  glossary: 'scientific-terminology-glossary',
  troubleshooting: 'troubleshooting',
  'user-manual': 'introduction',
});

export function manualSectionForTopic(topicId) {
  return MANUAL_SECTION_BY_TOPIC[topicId] || 'introduction';
}

export async function openUserManual(topicId = 'user-manual', desktopBridge = globalThis.window?.moloptimaDesktop) {
  if (typeof desktopBridge?.openUserManual !== 'function') {
    return {
      ok: false,
      code: 'desktop_bridge_unavailable',
      message: 'The offline User Manual opens from the packaged MolOptima desktop application.',
    };
  }
  try {
    const result = await desktopBridge.openUserManual(manualSectionForTopic(topicId));
    return result?.ok
      ? result
      : {
        ok: false,
        code: result?.code || 'manual_open_failed',
        message: result?.message || 'The offline User Manual could not be opened.',
      };
  } catch {
    return { ok: false, code: 'manual_open_failed', message: 'The offline User Manual could not be opened.' };
  }
}
