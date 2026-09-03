import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let PrioritizationExplanationSection;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  PrioritizationExplanationSection = (await vite.ssrLoadModule('/src/PrioritizationExplanationSection.jsx')).default;
});

after(async () => {
  await vite?.close();
});

function render(prioritization) {
  return renderToStaticMarkup(React.createElement(PrioritizationExplanationSection, {
    compound: { prioritization },
  }));
}

test('renders base score and docking requirement without a final rank', () => {
  const html = render({
    status: 'awaiting_docking',
    priority_score: 0.72,
    ranking_score: null,
    ranking_position: null,
    rank_eligible: false,
    ranking_basis: 'requires_successful_vina_docking',
    ranking_version: 'moloptima_scientific_priority_v1',
    components: {
      qed: {
        raw_value: 0.8, normalized_value: 0.8, contribution: 0.36,
        weight_or_rule: 0.45, status: 'available', reason: 'Approved QED rule.',
        score_scope: 'priority_score',
      },
      vina_docking: {
        raw_value: null, normalized_value: null, contribution: null,
        weight_or_rule: '30% when available', status: 'docking_unavailable',
        reason: 'No value fabricated; Vina affinity is not binding free energy.',
        score_scope: 'combined_candidate_score',
      },
      chemprop_regression: {
        raw_value: {}, normalized_value: null, contribution: null,
        status: 'available_display_only', reason: 'Not weighted.', score_scope: 'not_scored',
      },
    },
    warnings: ['Docking evidence is unavailable.'],
  });

  assert.match(html, /Scientific Prioritization/);
  assert.doesNotMatch(html, /Rank:/);
  assert.match(html, /Base priority score/);
  assert.match(html, />0\.72</);
  assert.match(html, /Final scientific ranking unavailable until successful docking/);
  assert.match(html, /data-testid="prioritization-component-qed"/);
  assert.match(html, /data-testid="prioritization-component-vina_docking"/);
  assert.match(html, /docking_unavailable/);
  assert.match(html, /not binding free energy/);
  assert.match(html, /not weighted by this ranking policy/);
  assert.match(html, /Docking evidence is unavailable\./);
});

test('renders final rank and combined score for a docking-complete molecule', () => {
  const html = render({
    status: 'fully_scored',
    priority_score: 0.72,
    ranking_score: 0.804,
    ranking_position: 3,
    rank_eligible: true,
    ranking_basis: 'combined_candidate_score_70_percent_base_30_percent_vina',
    ranking_version: 'moloptima_scientific_priority_v1',
    components: {
      vina_docking: {
        raw_value: -8.2, normalized_value: 1, contribution: 0.3,
        status: 'available', reason: 'Protocol-dependent affinity.',
        score_scope: 'combined_candidate_score',
      },
    },
    warnings: [],
  });

  assert.match(html, /Rank: 3/);
  assert.match(html, />0\.804</);
  assert.match(html, />-8\.2</);
  assert.doesNotMatch(html, /unavailable until successful docking/);
});

test('does not hide or invent an explanation for legacy results', () => {
  const html = renderToStaticMarkup(React.createElement(PrioritizationExplanationSection, {
    compound: { priority_score: 0.5 },
  }));
  assert.equal(html, '');
});

test('renders the complete Prioritization v2 explanation without changing legacy output', () => {
  const html = renderToStaticMarkup(React.createElement(PrioritizationExplanationSection, {
    compound: {
      prioritization: { status: 'legacy-data-must-not-win' },
      prioritization_v2: {
        summary: {
          rank: 2,
          rank_eligible: true,
          docking_contribution: 0.24,
          admet_contribution: 0.42,
          molecular_quality_contribution: 0.16,
          base_score: 0.82,
          combined_liability_penalty_factor: 0.8,
          uncertainty_penalty_factor: 0.9,
          final_score: 0.5904,
        },
        components: {
          docking: { score: 0.8 },
          admet: { score: 0.7, member_domains: ['absorption'] },
          molecular_quality: { score: 0.8 },
        },
        docking: {
          best_vina_affinity_kcal_mol: -8.4,
          within_library_docking_desirability: 0.8,
          docking_rank: 2,
          docking_percentile: 90,
          delta_vina_vs_reference_kcal_mol: -1.1,
        },
        domains: {
          absorption: { domain_score: 0.7, domain_contribution: 0.21 },
        },
        endpoint_scoring: {
          caco2_wang: { desirability: 0.75, contribution: 0.15 },
        },
        liabilities: {
          combined_penalty_factor: 0.8,
          penalty_endpoints: [{ endpoint_id: 'ames', factor: 0.8, source: 'profile' }],
          gates: [{ endpoint_id: 'bbb_gmc', passed: false }],
          exclusion_reasons: ['Required endpoint gate failed'],
        },
        uncertainty: {
          factor: 0.9,
          warnings: ['BBB ensemble disagreement is elevated.'],
        },
        missing_data: [{
          endpoint_id: 'hia_hou',
          configured_policy: 'penalize',
          action_taken: 'neutral score with penalty',
        }],
        provenance: {
          profile_id: 'profile-a',
          profile_version: '2.0.0',
          profile_status: 'frozen',
          profile_sha256: 'abc123',
          target_mode: 'balanced',
          campaign_id: 'campaign-7',
        },
      },
    },
  }));

  assert.match(html, /Prioritization v2 Explanation/);
  assert.doesNotMatch(html, /legacy-data-must-not-win/);
  assert.match(html, /Rank: 2/);
  assert.match(html, /Final priority score/);
  assert.match(html, /0\.5904/);
  assert.match(html, /Within-library desirability/);
  assert.match(html, /Reference delta \(explanatory only\)/);
  assert.match(html, /ADMET domains and endpoint details/);
  assert.match(html, /Caco2 Wang/);
  assert.match(html, /ames: factor 0\.8/);
  assert.match(html, /bbb_gmc gate: failed/);
  assert.match(html, /Excluded: Required endpoint gate failed/);
  assert.match(html, /BBB ensemble disagreement is elevated/);
  assert.match(html, /Missing hia_hou: penalize/);
  assert.match(html, /abc123/);
  assert.match(html, /balanced/);
});
