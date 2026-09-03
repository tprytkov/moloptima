import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let DockingResultsSection;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  DockingResultsSection = (await vite.ssrLoadModule('/src/DockingResultsSection.jsx')).default;
});

after(async () => vite?.close());

function render(dockingResult) {
  return renderToStaticMarkup(React.createElement(DockingResultsSection, { compound: { docking_result: dockingResult } }));
}

test('shows scientific docking result and receptor provenance', () => {
  const html = render({
    status: 'success', best_mode: 2, best_vina_affinity_kcal_mol: -8.3,
    best_affinity_kcal_mol: -8.3, vina_affinity: -8.3, receptor_id: 'TARGET-1',
    vina_version: 'AutoDock Vina 1.2.7', prepared_receptor_sha256: 'a'.repeat(64),
    requested_num_modes: 9, returned_mode_count: 3,
    modes: [
      { mode: 1, affinity_kcal_mol: -7.0, rmsd_lb: 0, rmsd_ub: 0 },
      { mode: 2, affinity_kcal_mol: -8.3, rmsd_lb: 1, rmsd_ub: 1.5 },
      { mode: 3, affinity_kcal_mol: -7.8, rmsd_lb: 2, rmsd_ub: 2.5 },
    ],
    docking_configuration: {
      center_x: 1, center_y: 2, center_z: 3, size_x: 20, size_y: 21, size_z: 22,
      num_modes: 9,
    },
  });
  assert.match(html, /Best Vina affinity: -8\.3 kcal\/mol/);
  assert.match(html, /Best mode: 2/);
  assert.match(html, /most favorable \(most negative\) affinity is used for prioritization/);
  assert.match(html, /Alternative Vina poses \(3\)/);
  assert.match(html, /RMSD lower bound/);
  assert.match(html, /requested modes: 9/);
  assert.match(html, /returned modes: 3/);
  assert.match(html, /TARGET-1/);
  assert.match(html, /AutoDock Vina 1\.2\.7/);
  assert.match(html, /not binding free energy/);
});

test('shows docking family failure without hiding other result sections', () => {
  const html = render({ status: 'runtime_unavailable', warning: 'Vina executable missing.' });
  assert.match(html, /runtime_unavailable/);
  assert.match(html, /Vina executable missing/);
});
