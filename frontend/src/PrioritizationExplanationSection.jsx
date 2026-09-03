import React from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

function valueOrUnavailable(value) {
  if (value === null || value === undefined || value === '') {
    return 'Not available';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function componentLabel(name) {
  return name.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function PrioritizationExplanationSection({ compound }) {
  if (compound?.prioritization_v2 && typeof compound.prioritization_v2 === 'object') {
    return <V2PrioritizationExplanation explanation={compound.prioritization_v2} />;
  }
  const prioritization = compound?.prioritization;
  if (!prioritization || typeof prioritization !== 'object') {
    return null;
  }
  const components = Object.entries(prioritization.components || {}).filter(
    ([, component]) => component?.score_scope !== 'not_scored',
  );
  const displayOnly = Object.values(prioritization.components || {}).filter(
    (component) => component?.score_scope === 'not_scored',
  );
  const warnings = Array.isArray(prioritization.warnings) ? prioritization.warnings : [];
  const dockingRequired = prioritization.rank_eligible === false
    && prioritization.components?.vina_docking?.status !== 'available'
    && prioritization.priority_score !== null
    && prioritization.priority_score !== undefined;

  return (
    <Box component="section" aria-label="Scientific prioritization explanation" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}>
          <Box>
            <Typography variant="h2">Scientific Prioritization</Typography>
            <Typography variant="caption" color="text.secondary">
              Policy: {valueOrUnavailable(prioritization.ranking_version)}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {prioritization.ranking_position !== null && prioritization.ranking_position !== undefined ? (
              <Chip label={`Rank: ${prioritization.ranking_position}`} variant="outlined" />
            ) : null}
            <Chip label={valueOrUnavailable(prioritization.status)} variant="outlined" />
          </Stack>
        </Stack>

        {dockingRequired ? (
          <Alert severity="warning">
            Final scientific ranking unavailable until successful docking.
          </Alert>
        ) : null}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
          <Box>
            <Typography variant="caption" color="text.secondary">Base priority score</Typography>
            <Typography variant="h5">{valueOrUnavailable(prioritization.priority_score)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Scientific ranking score</Typography>
            <Typography variant="h5">{valueOrUnavailable(prioritization.ranking_score)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Ranking basis</Typography>
            <Typography variant="body2">{valueOrUnavailable(prioritization.ranking_basis)}</Typography>
          </Box>
        </Stack>

        {components.length > 0 ? (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="Prioritization components">
              <TableHead>
                <TableRow>
                  <TableCell>Component</TableCell>
                  <TableCell>Raw value</TableCell>
                  <TableCell>Normalized</TableCell>
                  <TableCell>Contribution</TableCell>
                  <TableCell>Status / rule</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {components.map(([name, component]) => (
                  <TableRow key={name} data-testid={`prioritization-component-${name}`}>
                    <TableCell>{componentLabel(name)}</TableCell>
                    <TableCell>{valueOrUnavailable(component.raw_value)}</TableCell>
                    <TableCell>{valueOrUnavailable(component.normalized_value)}</TableCell>
                    <TableCell>{valueOrUnavailable(component.contribution)}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{valueOrUnavailable(component.status)}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {valueOrUnavailable(component.weight_or_rule)} · {valueOrUnavailable(component.reason)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        ) : null}

        {displayOnly.length > 0 ? (
          <Alert severity="info">
            ChemBERTa, Chemprop regression, synthetic-accessibility, and structural-alert outputs remain visible in their raw sections but are not weighted by this ranking policy.
          </Alert>
        ) : null}
        {warnings.map((warning) => <Alert severity="warning" key={warning}>{warning}</Alert>)}
      </Stack>
    </Box>
  );
}

function V2PrioritizationExplanation({ explanation }) {
  const summary = explanation.summary ?? {};
  const docking = explanation.docking ?? {};
  const components = explanation.components ?? {};
  const domains = explanation.domains ?? {};
  const endpoints = explanation.endpoint_scoring ?? {};
  const liabilities = explanation.liabilities ?? {};
  const uncertainty = explanation.uncertainty ?? {};
  const missing = Array.isArray(explanation.missing_data) ? explanation.missing_data : [];
  const provenance = explanation.provenance ?? {};
  const componentRows = [
    ['Docking', components.docking?.score, summary.docking_contribution],
    ['ADMET', components.admet?.score, summary.admet_contribution],
    ['Molecular quality', components.molecular_quality?.score, summary.molecular_quality_contribution],
  ];

  return (
    <Box component="section" aria-label="Prioritization v2 explanation" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}>
          <Box>
            <Typography variant="h2">Prioritization v2 Explanation</Typography>
            <Typography variant="caption" color="text.secondary">
              Profile: {valueOrUnavailable(provenance.profile_id)} · {valueOrUnavailable(provenance.profile_version)}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={`Rank: ${valueOrUnavailable(summary.rank)}`} variant="outlined" />
            <Chip label={summary.rank_eligible ? 'Rank eligible' : 'Not rank eligible'} color={summary.rank_eligible ? 'success' : 'warning'} variant="outlined" />
          </Stack>
        </Stack>

        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Prioritization v2 top-level contributions">
            <TableHead><TableRow><TableCell>Component</TableCell><TableCell>Score</TableCell><TableCell>Contribution</TableCell></TableRow></TableHead>
            <TableBody>
              {componentRows.map(([label, score, contribution]) => (
                <TableRow key={label}><TableCell>{label}</TableCell><TableCell>{valueOrUnavailable(score)}</TableCell><TableCell>{valueOrUnavailable(contribution)}</TableCell></TableRow>
              ))}
              <TableRow><TableCell>Base score</TableCell><TableCell>{valueOrUnavailable(summary.base_score)}</TableCell><TableCell>—</TableCell></TableRow>
              <TableRow><TableCell>Liability penalty</TableCell><TableCell>{valueOrUnavailable(summary.combined_liability_penalty_factor)}</TableCell><TableCell>Multiplicative</TableCell></TableRow>
              <TableRow><TableCell>Uncertainty penalty</TableCell><TableCell>{valueOrUnavailable(summary.uncertainty_penalty_factor)}</TableCell><TableCell>Multiplicative</TableCell></TableRow>
              <TableRow><TableCell><strong>Final priority score</strong></TableCell><TableCell><strong>{valueOrUnavailable(summary.final_score)}</strong></TableCell><TableCell>—</TableCell></TableRow>
            </TableBody>
          </Table>
        </Box>

        <Accordion disableGutters defaultExpanded>
          <AccordionSummary expandIcon={<span aria-hidden="true">▾</span>}><Typography sx={{ fontWeight: 750 }}>Docking context</Typography></AccordionSummary>
          <AccordionDetails>
            <MetadataGrid rows={[
              ['Best Vina affinity (kcal/mol)', docking.best_vina_affinity_kcal_mol],
              ['Within-library desirability', docking.within_library_docking_desirability],
              ['Docking rank', docking.docking_rank],
              ['Docking percentile', docking.docking_percentile],
              ['Reference delta (explanatory only)', docking.delta_vina_vs_reference_kcal_mol],
            ]} />
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters>
          <AccordionSummary expandIcon={<span aria-hidden="true">▾</span>}><Typography sx={{ fontWeight: 750 }}>ADMET domains and endpoint details</Typography></AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              <Typography variant="body2">ADMET component score: {valueOrUnavailable(components.admet?.score)}</Typography>
              <SimpleObjectTable
                label="ADMET domain scores"
                rows={Object.entries(domains).filter(([domain]) => components.admet?.member_domains?.includes(domain)).map(([domain, values]) => [domain, values.domain_score, values.domain_contribution])}
              />
              <SimpleObjectTable
                label="Endpoint desirabilities and contributions"
                rows={Object.entries(endpoints).map(([endpoint, values]) => [endpoint, values.desirability, values.contribution])}
              />
            </Stack>
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters>
          <AccordionSummary expandIcon={<span aria-hidden="true">▾</span>}><Typography sx={{ fontWeight: 750 }}>Liabilities, gates, and exclusions</Typography></AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1}>
              <Typography variant="body2">Combined penalty factor: {valueOrUnavailable(liabilities.combined_penalty_factor)}</Typography>
              {(liabilities.penalty_endpoints ?? []).map((entry) => <Alert severity="warning" key={`${entry.endpoint_id}-${entry.source}`}>{entry.endpoint_id}: factor {valueOrUnavailable(entry.factor)} ({entry.source})</Alert>)}
              {(liabilities.gates ?? []).map((gate) => <Alert severity={gate.passed ? 'success' : 'error'} key={gate.endpoint_id}>{gate.endpoint_id} gate: {gate.passed ? 'passed' : 'failed'}</Alert>)}
              {(liabilities.exclusion_reasons ?? []).map((reason) => <Alert severity="error" key={reason}>Excluded: {reason}</Alert>)}
            </Stack>
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters>
          <AccordionSummary expandIcon={<span aria-hidden="true">▾</span>}><Typography sx={{ fontWeight: 750 }}>Uncertainty and missing data</Typography></AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1}>
              <Typography variant="body2">Ensemble-disagreement factor: {valueOrUnavailable(uncertainty.factor)}</Typography>
              {(uncertainty.warnings ?? []).map((warning) => <Alert severity="warning" key={warning}>{warning}</Alert>)}
              {missing.map((entry) => <Alert severity="warning" key={entry.endpoint_id}>Missing {entry.endpoint_id}: {entry.configured_policy} → {entry.action_taken}</Alert>)}
              {missing.length === 0 ? <Typography variant="caption">No configured endpoint values were missing.</Typography> : null}
            </Stack>
          </AccordionDetails>
        </Accordion>

        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>Profile provenance</Typography>
          <MetadataGrid rows={[
            ['Profile ID', provenance.profile_id],
            ['Profile version', provenance.profile_version],
            ['Profile status', provenance.profile_status],
            ['Profile SHA256', provenance.profile_sha256],
            ['Target mode', provenance.target_mode],
            ['Campaign ID', provenance.campaign_id],
          ]} />
        </Box>
      </Stack>
    </Box>
  );
}

function SimpleObjectTable({ label, rows }) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label={label}>
        <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Score / desirability</TableCell><TableCell>Contribution</TableCell></TableRow></TableHead>
        <TableBody>{rows.map(([name, score, contribution]) => (
          <TableRow key={name}><TableCell>{componentLabel(name)}</TableCell><TableCell>{valueOrUnavailable(score)}</TableCell><TableCell>{valueOrUnavailable(contribution)}</TableCell></TableRow>
        ))}</TableBody>
      </Table>
    </Box>
  );
}

function MetadataGrid({ rows }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 1 }}>
      {rows.map(([label, value]) => (
        <Box key={label}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="body2">{valueOrUnavailable(value)}</Typography></Box>
      ))}
    </Box>
  );
}
