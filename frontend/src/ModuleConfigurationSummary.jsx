import React from 'react';
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';

const STATUS_COLORS = {
  Completed: 'success',
  'Completed with warnings': 'warning',
  Queued: 'info',
  Running: 'info',
  Cancelled: 'default',
  'Not run': 'default',
  Failed: 'error',
  'Requires update': 'warning',
  'Results Need Recalculation': 'warning',
  Ready: 'primary',
  'Not generated': 'default',
};

export default function ModuleConfigurationSummary({ title = 'Configuration', status, items, actions }) {
  return (
    <Paper variant="outlined" component="section" aria-label={`${title} summary`} sx={{ p: 2, minWidth: 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={1.5}>
        <Stack direction="row" alignItems="center" spacing={1} useFlexGap flexWrap="wrap">
          <Typography variant="h2">{title}</Typography>
          <Chip size="small" label={status} color={STATUS_COLORS[status] || 'default'} variant={['Not generated', 'Not run', 'Cancelled'].includes(status) ? 'outlined' : 'filled'} />
        </Stack>
        {actions ? <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">{actions}</Stack> : null}
      </Stack>
      <Box
        component="dl"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
          gap: 1.5,
          mt: 2,
          mb: 0,
        }}
      >
        {items.map((item) => (
          <Box key={item.label} sx={{ minWidth: 0 }}>
            <Typography component="dt" variant="caption" color="text.secondary">{item.label}</Typography>
            <Typography component="dd" variant="body2" fontWeight={700} sx={{ m: 0, overflowWrap: 'anywhere' }}>{item.value}</Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
