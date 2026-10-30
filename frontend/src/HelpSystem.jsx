import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Popover,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import SearchIcon from '@mui/icons-material/Search';
import {
  CONTEXT_HELP,
  GLOSSARY,
  filterHelpTopics,
  helpTopic,
  helpTopics,
} from './helpContent.js';

function TopicSections({ topic }) {
  return (
    <Stack spacing={2.25}>
      {topic.sections.map((section) => (
        <Box component="section" key={section.heading}>
          <Typography component="h3" variant="h6" sx={{ mb: 0.75, fontSize: '1rem', fontWeight: 700 }}>
            {section.heading}
          </Typography>
          {(section.paragraphs || []).map((paragraph) => (
            <Typography key={paragraph} variant="body2" sx={{ mb: 0.8, maxWidth: '80ch' }}>{paragraph}</Typography>
          ))}
          {section.bullets ? (
            <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 2.5 }}>
              {section.bullets.map((item) => <Typography component="li" variant="body2" key={item} sx={{ mb: 0.45 }}>{item}</Typography>)}
            </Box>
          ) : null}
          {section.numbered ? (
            <Box component="ol" sx={{ mt: 0.5, mb: 0, pl: 2.5 }}>
              {section.numbered.map((item) => <Typography component="li" variant="body2" key={item} sx={{ mb: 0.45 }}>{item}</Typography>)}
            </Box>
          ) : null}
        </Box>
      ))}
    </Stack>
  );
}

function GlossaryContent({ query = '' }) {
  const normalized = query.trim().toLowerCase();
  const entries = normalized
    ? GLOSSARY.filter(([term, definition]) => `${term} ${definition}`.toLowerCase().includes(normalized))
    : GLOSSARY;
  return (
    <Box component="dl" aria-label="MolOptima scientific glossary" sx={{ m: 0 }}>
      {entries.map(([term, definition]) => (
        <Box key={term} sx={{ py: 1.1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography component="dt" variant="subtitle2" sx={{ fontWeight: 700 }}>{term}</Typography>
          <Typography component="dd" variant="body2" color="text.secondary" sx={{ m: 0, mt: 0.25, maxWidth: '80ch' }}>{definition}</Typography>
        </Box>
      ))}
      {!entries.length ? <Typography variant="body2" color="text.secondary">No glossary terms match this search.</Typography> : null}
    </Box>
  );
}

export function HelpWorkspace({ initialTopicId = 'getting-started', onTopicChange }) {
  const [query, setQuery] = useState('');
  const [selectedTopicId, setSelectedTopicId] = useState(initialTopicId);
  const headingRef = useRef(null);
  const allTopics = useMemo(() => helpTopics(), []);
  const matches = useMemo(() => filterHelpTopics(query), [query]);
  const topic = helpTopic(selectedTopicId);

  useEffect(() => {
    if (initialTopicId) setSelectedTopicId(initialTopicId);
  }, [initialTopicId]);

  const selectTopic = (topicId) => {
    setSelectedTopicId(topicId);
    onTopicChange?.(topicId);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  return (
    <Box sx={{ width: '100%', maxWidth: 1440, mx: 'auto', minWidth: 0 }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography component="h1" variant="h1">MolOptima Help</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '80ch' }}>
          Offline guidance for workflows, scientific interpretation, terminology, and limitations. Help is informational and never runs or changes a calculation.
        </Typography>
      </Stack>

      <TextField
        fullWidth
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        label="Search Help"
        placeholder="Search topics, terms, or statuses"
        inputProps={{ 'aria-label': 'Search MolOptima Help' }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        sx={{ mb: 2, maxWidth: 720 }}
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '240px minmax(0, 1fr)' }, gap: 2, alignItems: 'start', minWidth: 0 }}>
        <Paper component="nav" aria-label="Help topics" variant="outlined" sx={{ minWidth: 0, maxHeight: { md: 'calc(100vh - 220px)' }, overflowY: 'auto' }}>
          {query ? (
            <Box sx={{ px: 1.5, pt: 1.25 }}>
              <Typography variant="overline" color="text.secondary">{matches.length} matching topics</Typography>
            </Box>
          ) : null}
          <List dense disablePadding sx={{ py: 0.75 }}>
            {(query ? matches : allTopics).map((item) => (
              <ListItemButton
                key={item.id}
                selected={selectedTopicId === item.id}
                onClick={() => selectTopic(item.id)}
                aria-current={selectedTopicId === item.id ? 'page' : undefined}
                sx={{ mx: 0.75, mb: 0.25, borderRadius: 1, alignItems: 'flex-start' }}
              >
                <ListItemText
                  primary={item.title}
                  secondary={item.category}
                  primaryTypographyProps={{ fontSize: '0.82rem', fontWeight: selectedTopicId === item.id ? 700 : 550 }}
                  secondaryTypographyProps={{ fontSize: '0.68rem' }}
                />
              </ListItemButton>
            ))}
          </List>
          {query && !matches.length ? <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, pb: 1.5 }}>No Help topics match this search.</Typography> : null}
        </Paper>

        <Paper component="article" variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, minWidth: 0, overflowWrap: 'anywhere' }}>
          <Typography ref={headingRef} tabIndex={-1} component="h2" variant="h2" sx={{ fontSize: '1.3rem', mb: 0.5, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 3 } }}>
            {topic.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{topic.summary}</Typography>
          <Divider sx={{ mb: 2 }} />
          {selectedTopicId === 'glossary' ? <GlossaryContent query={query} /> : <TopicSections topic={topic} />}
        </Paper>
      </Box>
    </Box>
  );
}

export function ModuleHelpDialog({ open, moduleHelp, onClose, onOpenFullHelp }) {
  if (!moduleHelp) return null;
  const topic = helpTopic(moduleHelp.topicId);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="module-help-title"
      PaperProps={{ sx: { maxHeight: 'min(760px, calc(100vh - 32px))' } }}
    >
      <DialogTitle id="module-help-title" component="h2" sx={{ pr: 7 }}>
        {moduleHelp.title}
        <IconButton onClick={onClose} aria-label={`Close ${moduleHelp.title}`} sx={{ position: 'absolute', right: 12, top: 10 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ overflowWrap: 'anywhere' }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{topic.summary}</Typography>
        {moduleHelp.terms?.length ? (
          <Box component="section" sx={{ mb: 2 }}>
            <Typography component="h3" variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>Key terms</Typography>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" aria-label={`${moduleHelp.title} key terms`}>
              {moduleHelp.terms.map((termId) => (
                <Paper key={termId} variant="outlined" sx={{ pl: 1, pr: 0.25, py: 0.25, display: 'flex', alignItems: 'center', gap: 0.25 }}>
                  <Typography variant="caption" sx={{ fontWeight: 650 }}>{CONTEXT_HELP[termId]?.label}</Typography>
                  <ContextHelp termId={termId} onLearnMore={onOpenFullHelp} />
                </Paper>
              ))}
            </Stack>
          </Box>
        ) : null}
        <TopicSections topic={topic} />
      </DialogContent>
      <DialogActions sx={{ px: 2.5, py: 1.5 }}>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={() => onOpenFullHelp?.(moduleHelp.topicId)}>Open full Help</Button>
      </DialogActions>
    </Dialog>
  );
}

export function ContextHelp({ termId, onLearnMore, size = 'small' }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const content = CONTEXT_HELP[termId];
  if (!content) return null;
  const open = Boolean(anchorEl);
  const close = () => setAnchorEl(null);
  return (
    <>
      <IconButton
        size={size}
        color="primary"
        aria-label={`Help: ${content.label}`}
        aria-haspopup="dialog"
        aria-expanded={open ? 'true' : undefined}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={{ p: 0.5, flex: '0 0 auto' }}
      >
        <HelpOutlineIcon fontSize="inherit" />
      </IconButton>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 1.5, width: 'min(340px, calc(100vw - 32px))', maxHeight: 'min(420px, calc(100vh - 32px))', overflowY: 'auto' } } }}
      >
        <Typography component="h3" variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>{content.label}</Typography>
        <Typography variant="body2">{content.text}</Typography>
        <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 1 }}>
          <Button size="small" onClick={close}>Close</Button>
          <Button size="small" onClick={() => { close(); onLearnMore?.(content.topicId); }}>Learn more</Button>
        </Stack>
      </Popover>
    </>
  );
}
