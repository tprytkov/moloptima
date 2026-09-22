import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let DockingResultsSection;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/DockingResultsSection.jsx');
  DockingResultsSection = module.default;
});

after(async () => vite?.close());

function render(dockingResult) {
  return renderToStaticMarkup(React.createElement(DockingResultsSection, {
    compound: { molecule_id: 'CMPD-01', docking_result: dockingResult },
  }));
}

test('shows scientific docking result and receptor provenance', () => {
  const html = render({
    status: 'success', best_mode: 2, best_vina_affinity_kcal_mol: -8.3,
    best_affinity_kcal_mol: -8.3, vina_affinity: -8.3, receptor_id: 'TARGET-1',
    vina_version: 'AutoDock Vina 1.2.7', vina_runtime_source: 'packaged',
    prepared_receptor_sha256: 'a'.repeat(64), pose_sha256: 'b'.repeat(64),
    receptor_source: 'uploaded_prepared_pdbqt', receptor_source_filename: 'target-1.pdbqt',
    ligand_preparation: 'rdkit_3d_then_openbabel_pdbqt', ligand_preparation_status: 'success',
    obabel_version: 'Open Babel 3.1.0', obabel_runtime_source: 'packaged',
    configuration_reference: 'c'.repeat(64), runtime_duration_seconds: 18.4,
    pose_available: true, pose_file: 'docking/poses/a-very-long-pose-artifact-name.pdbqt',
    requested_num_modes: 9, returned_mode_count: 3,
    modes: [
      { mode: 1, affinity_kcal_mol: -7.0, rmsd_lb: 0, rmsd_ub: 0 },
      { mode: 2, affinity_kcal_mol: -8.3, rmsd_lb: 1, rmsd_ub: 1.5 },
      { mode: 3, affinity_kcal_mol: -7.8, rmsd_lb: 2, rmsd_ub: 2.5 },
    ],
    docking_configuration: {
      center_x: 1, center_y: 2, center_z: 3, size_x: 20, size_y: 21, size_z: 22,
      num_modes: 9, exhaustiveness: 8, seed: 2025,
    },
  });
  assert.match(html, /Best Vina affinity/);
  assert.match(html, /-8\.3/);
  assert.match(html, /Best pose/);
  assert.match(html, /most favorable \(most negative\) affinity is used for prioritization/);
  assert.match(html, /Returned Vina poses \(3\)/);
  assert.match(html, /RMSD lower bound \(Å\)/);
  assert.match(html, /9 requested/);
  assert.match(html, /Poses returned/);
  assert.match(html, /Docking protocol and provenance/);
  assert.match(html, /Box center \(Å\)/);
  assert.match(html, /Box dimensions \(Å\)/);
  assert.match(html, /Exhaustiveness/);
  assert.match(html, /Random seed/);
  assert.match(html, /Pose artifact/);
  assert.match(html, /a-very-long-pose-artifact-name\.pdbqt/);
  assert.match(html, /2 \(best\)/);
  assert.match(html, /TARGET-1/);
  assert.match(html, /AutoDock Vina 1\.2\.7/);
  assert.match(html, /not binding free energy/);
});

test('shows docking family failure without hiding other result sections', () => {
  const html = render({ status: 'runtime_unavailable', warning: 'Vina executable missing.' });
  assert.match(html, /Vina runtime unavailable/);
  assert.doesNotMatch(html, /runtime_unavailable/);
  assert.match(html, /Vina executable missing/);
});

test('shows an honest empty pose state after a successful run', () => {
  const html = render({
    status: 'success', best_mode: 1, best_vina_affinity_kcal_mol: -7.2,
    requested_num_modes: 3, returned_mode_count: 0, modes: [],
  });
  assert.match(html, /Docking completed, but no pose-level rows were returned/);
});

test('humanizes known and unknown docking statuses', () => {
  assert.equal(module.dockingStatusLabel('not_run_invalid_molecule'), 'Not run — invalid molecule');
  assert.equal(module.dockingStatusLabel('custom_backend_state'), 'Custom backend state');
});
