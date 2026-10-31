export const HELP_TOPIC_ORDER = [
  'getting-started',
  'scientific-workflow',
  'molecules',
  'receptor-docking',
  'admet',
  'chemical-space',
  'design-logic',
  'prioritization',
  'results',
  'analysis',
  'experimental-data',
  'settings',
  'scientific-concepts',
  'glossary',
  'troubleshooting',
  'user-manual',
];

export const HELP_TOPICS = {
  'getting-started': {
    category: 'Start here',
    title: 'Getting Started',
    summary: 'Orient yourself before running a calculation.',
    keywords: ['student', 'first calculation', 'start', 'overview'],
    sections: [
      {
        heading: 'What MolOptima does',
        paragraphs: [
          'MolOptima brings molecule validation, computational prediction, docking, evidence review, and prioritization into one traceable local workflow. Its predictions support scientific decisions; they are not experimental measurements and do not establish safety, efficacy, or biological activity.',
          'You can study one molecule or a library. Use only the modules that answer your project question—every calculation does not require every workspace.',
        ],
      },
      {
        heading: 'Before you begin',
        bullets: [
          'Check that the application status shows Backend connected.',
          'Import structures and review validity, warnings, identity, and provenance.',
          'Decide which computational evidence is relevant before running it.',
          'Keep predictions attached to their model, protocol, units, and calculation.',
        ],
      },
    ],
  },
  'scientific-workflow': {
    category: 'Start here',
    title: 'Typical Scientific Workflow',
    summary: 'A flexible path through MolOptima workspaces.',
    keywords: ['workflow', 'steps', 'new calculation'],
    sections: [
      {
        heading: 'A typical path',
        numbered: [
          'Add molecules and inspect molecule validity.',
          'Configure a receptor and docking protocol if docking evidence is needed.',
          'Run the scientific calculations appropriate to the project.',
          'Inspect individual absorption, distribution, metabolism, excretion, and toxicity (ADMET) endpoints.',
          'Explore Chemical Space when library relationships or structural neighbors matter.',
          'Inspect independent Design Logic evidence layers for docked compounds.',
          'Apply Standard Prioritization or a configured Multi-Parameter Prioritization method when ranking is appropriate.',
          'Review persisted Results and provenance.',
          'Use Pareto or Sensitivity Analysis for library trade-offs and ranking behavior when applicable.',
          'Inspect imported, persisted, or external experimental evidence without transferring measurements between compounds.',
        ],
      },
      {
        heading: 'A workflow is not a checklist',
        paragraphs: ['Single-compound work does not produce library ranks or Pareto fronts. Docking is optional. External evidence lookup is separate from local prediction. Choose modules because they answer a scientific question, not merely because they are available.'],
      },
    ],
  },
  molecules: {
    category: 'Workspace guide',
    title: 'Molecules',
    summary: 'Import, validate, identify, and trace molecular structures.',
    keywords: ['SMILES', 'SDF', 'canonical', 'valid', 'warning', 'provenance'],
    sections: [
      {
        heading: 'What this workspace does',
        paragraphs: ['Molecules accepts supported structure inputs, preserves source provenance, validates chemical records, and creates the canonical representation used by downstream calculations. Molecular identity depends on structure, not only on a displayed name or file name.'],
      },
      {
        heading: 'How to interpret this page',
        paragraphs: ['A valid molecule can still carry a warning. A warning identifies information to review; it is not the same as an invalid structure. Invalid records remain visible for traceability but are not sent into scientific prediction.'],
        bullets: [
          'SMILES is a line notation for molecular connectivity.',
          'SDF can preserve bond orders, formal charges, properties, and coordinates.',
          'Canonical representation provides a consistent downstream identity; it does not erase source provenance.',
        ],
      },
    ],
  },
  'receptor-docking': {
    category: 'Workspace guide',
    title: 'Receptor & Docking',
    summary: 'Prepare a receptor, define a search box, and interpret protocol-dependent docking.',
    keywords: ['receptor', 'binding site', 'docking box', 'Vina', 'PDBQT', 'affinity'],
    sections: [
      {
        heading: 'Main workflow',
        bullets: [
          'Select a receptor and review chains, waters, hetero groups, and alternate locations.',
          'Prepare the receptor and preserve its provenance.',
          'Define the binding-site search box from a reference ligand or explicit coordinates.',
          'Confirm the docking setup before running docking.',
        ],
      },
      {
        heading: 'How to interpret this page',
        paragraphs: ['AutoDock Vina produces a computational docking and screening score under the chosen receptor, ligand, box, and search protocol. It is not an experimental binding affinity, measured potency, or measured free energy. Comparisons are meaningful only in the context of a consistent, scientifically appropriate protocol.'],
      },
      {
        heading: 'Important limitations',
        paragraphs: ['Preparation choices, protonation assumptions, receptor conformation, search-box placement, and sampling can change poses and scores. A plausible pose remains a hypothesis requiring further analysis and, where appropriate, experimental testing.'],
      },
    ],
  },
  admet: {
    category: 'Workspace guide',
    title: 'ADMET',
    summary: 'Interpret the fixed classification and regression panel endpoint by endpoint.',
    keywords: ['ChemBERTa', 'GMC-MPNN', 'Chemprop', 'BBB', 'Caco2', 'PPB', 'Vd'],
    sections: [
      {
        heading: 'What ADMET means',
        paragraphs: ['ADMET stands for absorption, distribution, metabolism, excretion, and toxicity. MolOptima presents separate model outputs; it does not collapse them into one overall ADMET score.'],
      },
      {
        heading: 'Current model families',
        bullets: [
          'ChemBERTa classification: HIA, P-gp inhibition, CYP1A2, CYP2C19, CYP2C9, CYP2D6, CYP3A4, hERG, and AMES.',
          'GMC-MPNN classification: blood-brain barrier (BBB).',
          'Chemprop regression: Caco2, lipophilicity, aqueous solubility, plasma protein binding (PPB), and volume of distribution (Vd).',
        ],
      },
      {
        heading: 'How to interpret this page',
        paragraphs: ['Read each endpoint with its model family, status, unit, and applicability context. A classification probability is the model output for a class, not a formal confidence estimate or an experimental frequency. Missing or failed endpoints must remain missing or failed rather than being treated as zero.'],
      },
      {
        heading: 'BBB production semantics',
        paragraphs: ['BBB uses the raw mean from a five-seed GMC-MPNN ensemble and a classification threshold of 0.5. The threshold status is provisional_raw and calibration status is not_frozen. The displayed probability is the model output for the BBB-positive class; it is not a formal confidence estimate.'],
      },
      {
        heading: 'Chemprop endpoints and units',
        bullets: [
          'Caco2 — predicted permeability in log10(Papp [cm/s]).',
          'Lipophilicity — predicted log-ratio.',
          'Aqueous Solubility — predicted log mol/L.',
          'PPB — predicted percent bound.',
          'Vd — predicted L/kg.',
        ],
        paragraphs: ['MolOptima does not define universal favorable or unfavorable cutoffs for these regression values. Interpret them in project context and with endpoint-specific evidence.'],
      },
      {
        heading: 'Scientific visualizations',
        bullets: [
          'Probability bars use the 0–1 predicted-probability scale; probability is not formal confidence.',
          'Regression scales preserve the raw value and unit. Their position is relative only to available values for the same endpoint in the current collection.',
          'The heat map uses probability for classification columns and independently scaled display color for each regression column. Color intensity is not comparable across unrelated endpoints.',
          'Histograms describe the current collection of predictions; they are not model-validation plots.',
          'Relationship plots show two existing endpoint values for each molecule. An apparent trend does not establish causation.',
          'Compound comparison preserves separate endpoint values and does not calculate an overall score or choose a winner.',
        ],
      },
    ],
  },
  'chemical-space': {
    category: 'Workspace guide',
    title: 'Chemical Space',
    summary: 'Explore projections, fingerprints, neighbors, and scaffolds without conflating metrics.',
    keywords: ['Morgan', 'Tanimoto', 'PCA', 'projection', 'scaffold', 'neighbors'],
    sections: [
      {
        heading: 'Key methods',
        bullets: [
          'Morgan fingerprints encode circular local structural environments as a comparison representation.',
          'Tanimoto similarity compares two fingerprints and reports their feature-set overlap.',
          'Principal component analysis (PCA) projects variation into fewer dimensions for visualization.',
          'Scaffold grouping organizes molecules by implemented scaffold relationships.',
        ],
      },
      {
        heading: 'How to interpret this page',
        paragraphs: ['Use PCA to inspect projection patterns and Tanimoto for explicit fingerprint similarity. Distance in a PCA projection is not Tanimoto molecular similarity, and a projection is not itself a similarity measurement. Apparent visual groups should be checked against the underlying molecular evidence.'],
      },
    ],
  },
  'design-logic': {
    category: 'Workspace guide',
    title: 'Design Logic',
    summary: 'Compare independent structural, geometric, interaction, docking, and experimental evidence.',
    keywords: ['pharmacophore', 'ProLIF', 'MMP', 'scaffold hop', 'Jaccard'],
    sections: [
      {
        heading: 'Independent evidence layers',
        bullets: [
          'Morgan fingerprint similarity and scaffold relationship.',
          'Ligand-centered pharmacophore features compared in the receptor frame.',
          'Protein–ligand interaction fingerprints (ProLIF) and ligand-relative Jaccard overlap.',
          'Vina docking context.',
          'Matched molecular pair (MMP) structural relationships.',
          'Available experimental context.',
        ],
      },
      {
        heading: 'How to interpret this page',
        paragraphs: ['Design Logic deliberately does not calculate an overall score or select a winner. Preserved pharmacophore geometry or interactions are evidence of structural or interaction similarity, not proof of equal activity. Structural divergence plus preserved interactions does not automatically establish a scaffold hop.'],
      },
      {
        heading: 'MMP and pharmacophore limits',
        paragraphs: ['An MMP identifies a defined structural transformation; without paired experimental evidence it does not establish the direction or cause of an activity change. Pharmacophore overlap compares feature classes and spatial matching but does not experimentally validate activity.'],
      },
    ],
  },
  prioritization: {
    category: 'Workspace guide',
    title: 'Prioritization',
    summary: 'Use configured evidence to support—not replace—scientific decision-making.',
    keywords: ['Standard Prioritization', 'Multi-Parameter Prioritization', 'Priority Rank', 'Evidence Status'],
    sections: [
      {
        heading: 'Current methods',
        paragraphs: ['Standard Prioritization applies the implemented standard method. Multi-Parameter Prioritization uses an applied Prioritization Profile containing Evidence Weights, Prioritization Rules, and related Target Context.'],
      },
      {
        heading: 'How to interpret this page',
        paragraphs: ['Priority Rank orders eligible candidates within this calculation. Prioritization Score reflects the implemented method and available configured evidence. Neither means that the highest-ranked candidate is objectively superior or experimentally validated. Use Ranking Explanation and Evidence Status to understand why a candidate appears where it does.'],
      },
      {
        heading: 'Configuration changes',
        paragraphs: ['Results Need Recalculation means an applied scientific setup changed after the displayed results were produced. Existing results remain historical until the relevant calculation is rerun.'],
      },
    ],
  },
  results: {
    category: 'Workspace guide',
    title: 'Results',
    summary: 'Review persisted calculation evidence, provenance, and exports.',
    keywords: ['persisted', 'filter', 'export', 'missing', 'not run', 'failed'],
    sections: [
      {
        heading: 'What this workspace does',
        paragraphs: ['Results is the main persisted scientific review workspace. Filtering and sorting change the view, not the saved science. Use compound inspection and provenance to connect each displayed value to its calculation and source.'],
      },
      {
        heading: 'How to interpret status',
        bullets: [
          'Available — a result is present for this calculation.',
          'Missing — the expected value is absent and must not be replaced with zero.',
          'Not run — the calculation was not requested.',
          'Failed — execution was attempted but did not produce that result.',
          'Not used — the evidence was not part of the applicable method or configuration.',
        ],
      },
    ],
  },
  analysis: {
    category: 'Workspace guide',
    title: 'Analysis',
    summary: 'Inspect multi-objective trade-offs and rank response to configured perturbations.',
    keywords: ['Pareto', 'non-dominated', 'Sensitivity', 'rank range', 'top-N'],
    sections: [
      {
        heading: 'Pareto Analysis',
        paragraphs: ['A Pareto front contains candidates that are non-dominated across the selected objectives. Pareto Analysis does not calculate one combined Pareto score and does not choose a winner; it exposes trade-offs.'],
      },
      {
        heading: 'Sensitivity Analysis',
        paragraphs: ['Sensitivity Analysis perturbs the configured Prioritization Profile and observes ranking movement, such as rank ranges and top-N frequency. These outputs describe behavior under that perturbation procedure. They are not statistical confidence and are not formal uncertainty calibration.'],
      },
      {
        heading: 'How to interpret this page',
        paragraphs: ['Use Analysis to ask how alternatives trade off and how rankings respond to defined configuration changes. Keep conclusions tied to the selected objectives, perturbation settings, and current calculation.'],
      },
    ],
  },
  'experimental-data': {
    category: 'Workspace guide',
    title: 'Experimental Data',
    summary: 'Keep measurements attached to their source compounds and evidence layer.',
    keywords: ['ChEMBL', 'exact evidence', 'analog evidence', 'patent', 'target', 'measurement'],
    sections: [
      {
        heading: 'Three evidence sources',
        numbered: [
          'Imported experimental measurements owned by the imported dataset.',
          'Persisted pipeline evidence owned by the saved calculation.',
          'External ChEMBL Experimental Neighborhood records retrieved for an exact structure or structural analog.',
        ],
      },
      {
        heading: 'How to interpret this page',
        paragraphs: ['Exact evidence and analog evidence are not interchangeable. Analog activity belongs to the measured analog, not automatically to the query compound. Structural similarity does not establish biological equivalence, and target or reference activity does not become query activity.'],
      },
      {
        heading: 'Absence is not a result',
        paragraphs: ['No matching experimental record does not mean a compound is inactive. Patent occurrence is not experimental validation, patent absence does not establish novelty, and an unsuccessful external lookup does not modify local MolOptima data.'],
      },
    ],
  },
  settings: {
    category: 'Workspace guide',
    title: 'Settings',
    summary: 'Inspect global runtime availability and diagnostics.',
    keywords: ['Available', 'Unavailable', 'Probe Timed Out', 'Probe Error', 'runtime'],
    sections: [
      {
        heading: 'What runtime status means',
        paragraphs: ['Available means that the runtime qualification probe succeeded. It does not mean a model has run for the current molecule, that the current calculation contains a result, or that a prediction is guaranteed correct.'],
        bullets: [
          'Unavailable — the component could not be used by the current runtime.',
          'Probe Timed Out — availability was not determined before the probe limit.',
          'Probe Error — the probe ended with a reported error.',
        ],
      },
      {
        heading: 'How to interpret this page',
        paragraphs: ['Settings describes application-wide runtime capability. Scientific configuration and calculation results remain in their owning workspaces. Refreshing runtime status checks availability; it does not run molecule predictions.'],
      },
    ],
  },
  'scientific-concepts': {
    category: 'Reference',
    title: 'Scientific Concepts',
    summary: 'Important distinctions that apply across workspaces.',
    keywords: ['prediction', 'evidence', 'measurement', 'probability', 'similarity'],
    sections: [
      {
        heading: 'Prediction and measurement',
        paragraphs: ['A model output is a computational estimate produced under a specific model contract. Experimental evidence is a measurement with its own assay, compound, target, conditions, and provenance. One must not be presented as the other.'],
      },
      {
        heading: 'Similarity and equivalence',
        paragraphs: ['Structural, pharmacophore, or interaction similarity can support a hypothesis. None alone establishes equal activity, mechanism, safety, or experimental outcome.'],
      },
      {
        heading: 'Missing evidence',
        paragraphs: ['Missing, unavailable, not run, failed, and not used describe different states. None should be silently converted to a numerical zero or interpreted as negative experimental evidence.'],
      },
    ],
  },
  glossary: {
    category: 'Reference',
    title: 'Glossary',
    summary: 'Searchable definitions for terms used in MolOptima.',
    keywords: ['definitions', 'abbreviations', 'terms'],
    sections: [],
  },
  troubleshooting: {
    category: 'Reference',
    title: 'Troubleshooting & Status Interpretation',
    summary: 'Understand common states and the next appropriate action.',
    keywords: ['No active calculation', 'Configuration Required', 'recalculation', 'timeout', 'failed'],
    sections: [
      {
        heading: 'Workflow states',
        bullets: [
          'No active calculation — start a new calculation or deliberately open a saved calculation.',
          'Configuration Required — complete the owning workspace setup before running that calculation.',
          'Results Need Recalculation — rerun the relevant calculation to apply the newer configuration.',
          'Not run — request the calculation only if it is scientifically relevant.',
          'Not used — the current method or configuration did not use that evidence.',
          'No matching records — no record matched the search; do not infer inactivity or novelty.',
        ],
      },
      {
        heading: 'Runtime states',
        bullets: [
          'Unavailable — inspect Runtime Details and the reported reason.',
          'Failed — inspect the owning calculation or runtime error without replacing the result.',
          'Probe Timed Out — retry only when appropriate; the earlier probe did not establish availability.',
        ],
      },
    ],
  },
  'user-manual': {
    category: 'Reference',
    title: 'User Manual',
    summary: 'About the installed educational guidance.',
    keywords: ['manual', 'offline', 'documentation'],
    sections: [
      {
        heading: 'Installed help',
        paragraphs: ['This Help workspace is the authoritative, offline educational guide included with the MolOptima interface. It remains available without an internet connection and without an active calculation.'],
      },
      {
        heading: 'Separate printable manual',
        paragraphs: ['A separate printable manual is not currently bundled with the desktop application. The repository manual requires terminology and navigation updates before it should be exposed as installed student guidance.'],
      },
    ],
  },
};

export const GLOSSARY = [
  ['ADMET', 'Absorption, distribution, metabolism, excretion, and toxicity; a group of distinct properties rather than one score.'],
  ['AMES', 'A classifier endpoint related to bacterial mutagenicity assay outcome.'],
  ['BBB', 'Blood-brain barrier; MolOptima reports a raw five-seed GMC-MPNN classification output for BBB-positive class membership.'],
  ['Caco-2', 'A Chemprop permeability endpoint reported as log10(Papp [cm/s]).'],
  ['ChemBERTa', 'The model family used for nine fixed ADMET classification endpoints.'],
  ['Chemprop', 'The model family used for five fixed ADMET regression endpoints.'],
  ['CYP', 'Cytochrome P450 enzyme-family endpoints used in metabolism-related classification.'],
  ['GMC-MPNN', 'The five-seed graph model ensemble used for BBB classification.'],
  ['HIA', 'Human intestinal absorption classification endpoint.'],
  ['hERG', 'A classification endpoint related to hERG channel liability.'],
  ['MMP', 'Matched molecular pair; two molecules related by a defined structural transformation.'],
  ['Morgan fingerprint', 'A circular-feature representation used for explicit molecular-structure comparison.'],
  ['P-gp', 'P-glycoprotein; MolOptima includes a P-gp inhibition classification endpoint.'],
  ['PCA', 'Principal component analysis; a lower-dimensional projection of variation, not a similarity metric.'],
  ['Pharmacophore', 'A set of chemical feature classes and their spatial arrangement used for geometric comparison.'],
  ['PPB', 'Plasma protein binding; a Chemprop endpoint reported as percent bound.'],
  ['ProLIF', 'Protein–ligand interaction fingerprints used to compare ligand-relative interaction patterns.'],
  ['Tanimoto similarity', 'Fingerprint feature-set overlap between two molecules; its meaning depends on the fingerprint definition.'],
  ['Vd', 'Volume of distribution; a Chemprop endpoint reported in L/kg.'],
  ['Vina', 'AutoDock Vina, used for protocol-dependent computational docking and screening scores.'],
];

export const MODULE_HELP = {
  Molecules: { topicId: 'molecules', title: 'Molecules Help', terms: ['molecule-validity'] },
  'Receptor & Docking': { topicId: 'receptor-docking', title: 'Receptor & Docking Help', terms: ['vina-score'] },
  ADMET: { topicId: 'admet', title: 'ADMET Help', terms: ['classification-probability', 'bbb-probability', 'admet-probability-bars', 'admet-regression-scales', 'admet-heat-map', 'admet-histogram', 'admet-scatter', 'admet-comparison'] },
  'Chemical Space': { topicId: 'chemical-space', title: 'Chemical Space Help', terms: ['tanimoto-similarity', 'pca-projection'] },
  'Design Logic': { topicId: 'design-logic', title: 'Design Logic Help', terms: ['independent-evidence', 'prolif-jaccard'] },
  Prioritization: { topicId: 'prioritization', title: 'Prioritization Help', terms: ['priority-rank', 'evidence-status'] },
  Results: { topicId: 'results', title: 'Results Help', terms: ['missing-evidence'] },
  Analysis: { topicId: 'analysis', title: 'Analysis Help', terms: ['pareto-front', 'sensitivity-analysis'] },
  'Experimental Data': { topicId: 'experimental-data', title: 'Experimental Data Help', terms: ['exact-analog-evidence'] },
  Settings: { topicId: 'settings', title: 'Settings Help', terms: ['runtime-available'] },
};

export const CONTEXT_HELP = {
  'molecule-validity': { label: 'Molecule validity', topicId: 'molecules', text: 'Valid means the structure passed the implemented import checks. A valid record may still have a warning that should be reviewed; warning and invalid are different states.' },
  'vina-score': { label: 'Vina score', topicId: 'receptor-docking', text: 'A Vina score is protocol-dependent computational docking evidence. It is not an experimental binding affinity, measured potency, or measured free energy.' },
  'classification-probability': { label: 'Classification probability', topicId: 'admet', text: 'This is a model output for the displayed class. It should not be interpreted as a formal confidence estimate or an experimental frequency.' },
  'bbb-probability': { label: 'BBB probability', topicId: 'admet', text: 'BBB uses the raw mean of five GMC-MPNN seeds and the provisional_raw threshold 0.5. Calibration status is not_frozen.' },
  'admet-probability-bars': { label: 'Probability bars', topicId: 'admet', text: 'Each bar shows an existing classification probability on a 0–1 scale. Probability is not formal confidence, and a threshold marker appears only where the current scientific contract defines one.' },
  'admet-regression-scales': { label: 'Regression scales', topicId: 'admet', text: 'The raw Chemprop value and unit remain primary. Scale position is a within-endpoint visual comparison for this collection, not a favorable range and not a score.' },
  'admet-heat-map': { label: 'ADMET heat map', topicId: 'admet', text: 'Classification columns use predicted probabilities. Regression columns are scaled independently for display; inspect the raw value and unit because intensity is not quantitatively equivalent across endpoints.' },
  'admet-histogram': { label: 'ADMET histogram', topicId: 'admet', text: 'The histogram shows how available predicted values are distributed in the current molecule set. It describes this collection and is not a model-validation metric.' },
  'admet-scatter': { label: 'ADMET relationship plot', topicId: 'admet', text: 'Each point is one molecule with available values for both selected endpoints. The plot supports exploration; an apparent trend does not establish a causal relationship.' },
  'admet-comparison': { label: 'Compound comparison', topicId: 'admet', text: 'Comparison keeps endpoint values, units, statuses, and provenance separate for 2–5 compounds. It does not create an overall ADMET score or select a winner.' },
  'tanimoto-similarity': { label: 'Tanimoto similarity', topicId: 'chemical-space', text: 'Tanimoto similarity measures overlap between the implemented molecular fingerprints. It is distinct from distance in a PCA projection.' },
  'pca-projection': { label: 'PCA projection', topicId: 'chemical-space', text: 'PCA places major variation into fewer display dimensions. Visual distance in this projection is not the same quantity as fingerprint similarity.' },
  'independent-evidence': { label: 'Independent evidence layers', topicId: 'design-logic', text: 'Design Logic keeps structural, pharmacophore, interaction, docking, MMP, and experimental context separate. It does not calculate an overall Design Logic score.' },
  'prolif-jaccard': { label: 'ProLIF interaction Jaccard', topicId: 'design-logic', text: 'This compares ligand-relative protein–ligand interaction fingerprint tokens. Similarity supports an interaction-pattern hypothesis; it does not prove equal activity.' },
  'priority-rank': { label: 'Priority Rank', topicId: 'prioritization', text: 'Priority Rank orders eligible candidates within this calculation and method. A higher rank is decision support, not experimental validation.' },
  'evidence-status': { label: 'Evidence Status', topicId: 'prioritization', text: 'Evidence Status describes whether the evidence required by the applied method is available or usable. Missing evidence is not automatically negative evidence.' },
  'missing-evidence': { label: 'Missing result', topicId: 'results', text: 'Missing, not run, failed, and not used have different meanings. None should be silently converted to zero.' },
  'pareto-front': { label: 'Pareto front', topicId: 'analysis', text: 'A Pareto front contains non-dominated trade-offs for selected objectives. It does not create one combined score or select a winner.' },
  'sensitivity-analysis': { label: 'Sensitivity Analysis', topicId: 'analysis', text: 'Sensitivity Analysis observes ranking movement under defined configuration perturbations. It is not statistical confidence or formal uncertainty calibration.' },
  'exact-analog-evidence': { label: 'Exact and analog evidence', topicId: 'experimental-data', text: 'Exact evidence is attached to the exact matched structure. Analog evidence belongs to the measured analog and must not be transferred to the query compound.' },
  'runtime-available': { label: 'Runtime Available', topicId: 'settings', text: 'Available means a runtime qualification probe succeeded. It does not mean the model has run for the current molecule or guarantee prediction correctness.' },
};

export function helpTopic(topicId) {
  return HELP_TOPICS[topicId] || HELP_TOPICS['getting-started'];
}

export function helpTopics() {
  return HELP_TOPIC_ORDER.map((id) => ({ id, ...HELP_TOPICS[id] }));
}

export function filterHelpTopics(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return helpTopics();
  return helpTopics().filter((topic) => {
    const searchable = [
      topic.title, topic.summary, ...(topic.keywords || []),
      ...topic.sections.flatMap((section) => [
        section.heading,
        ...(section.paragraphs || []),
        ...(section.bullets || []),
        ...(section.numbered || []),
      ]),
    ].join(' ').toLowerCase();
    if (searchable.includes(normalized)) return true;
    return topic.id === 'glossary' && GLOSSARY.some(([term, definition]) => `${term} ${definition}`.toLowerCase().includes(normalized));
  });
}

export function moduleHelpForNavigation(activeItem) {
  return MODULE_HELP[activeItem] || null;
}

export function contextHelpForModule(activeItem) {
  const moduleHelp = moduleHelpForNavigation(activeItem);
  return moduleHelp?.terms?.[0] || null;
}
