import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, IconButton, Stack, Tab, Tabs, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

export function shouldConfirmScientificSetupClose({ dirty, reason }) {
  return dirty && (reason === 'escapeKeyDown' || reason === 'backdropClick' || reason === 'closeButton');
}

export default function ScientificSetupDialog({
  open,
  title,
  context,
  sections = [],
  activeSection = 0,
  onSectionChange,
  children,
  dirty = false,
  validationErrors = [],
  loading = false,
  applyDisabled = false,
  runDisabled = false,
  showApply = true,
  applyLabel = 'Apply',
  applyAndRunLabel = 'Apply & Run',
  onCancel,
  onApply,
  onApplyAndRun,
  restoreFocusRef,
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const wasOpen = useRef(false);
  const restoreAfterDiscard = useRef(false);

  useEffect(() => {
    if (!open) setConfirmDiscard(false);
    if (wasOpen.current && !open && restoreFocusRef?.current) {
      queueMicrotask(() => restoreFocusRef.current?.focus());
    }
    wasOpen.current = open;
  }, [open, restoreFocusRef]);

  function requestClose(reason) {
    if (loading) return;
    if (shouldConfirmScientificSetupClose({ dirty, reason })) setConfirmDiscard(true);
    else onCancel?.();
  }

  function discardChanges() {
    restoreAfterDiscard.current = true;
    setConfirmDiscard(false);
    onCancel?.();
  }

  function restoreAfterDiscardTransition() {
    if (!restoreAfterDiscard.current) return;
    restoreAfterDiscard.current = false;
    restoreFocusRef?.current?.focus();
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={(_event, reason) => requestClose(reason)}
        fullWidth
        maxWidth="md"
        aria-labelledby="scientific-setup-title"
        aria-describedby="scientific-setup-context"
        slotProps={{
          paper: {
            sx: {
              width: { xs: 'calc(100% - 24px)', sm: 'min(820px, calc(100% - 48px))' },
              maxHeight: { xs: 'calc(100dvh - 24px)', sm: 'min(780px, calc(100dvh - 48px))' },
              m: { xs: 1.5, sm: 3 },
            },
          },
        }}
      >
        <DialogTitle sx={{ pr: 7, pb: context ? 0.75 : 2 }} id="scientific-setup-title">
          {title}
          <IconButton
            aria-label={`Close ${title}`}
            onClick={() => requestClose('closeButton')}
            disabled={loading}
            sx={{ position: 'absolute', right: 12, top: 12 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        {context ? <Typography id="scientific-setup-context" color="text.secondary" sx={{ px: 3, pb: 1.5 }}>{context}</Typography> : null}
        {sections.length ? (
          <Tabs
            value={activeSection}
            onChange={(_event, value) => onSectionChange?.(value)}
            aria-label={`${title} sections`}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ px: 2, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }}
          >
            {sections.map((section) => <Tab key={section.id || section.label} label={section.label} />)}
          </Tabs>
        ) : null}
        <DialogContent dividers sx={{ minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          <Stack spacing={2.5}>
            {validationErrors.length ? (
              <Alert severity="error" role="alert">
                <Typography variant="body2" fontWeight={700}>Review the configuration before applying it.</Typography>
                <Box component="ul" sx={{ my: 0.5, pl: 2.5 }}>
                  {validationErrors.map((message) => <li key={message}>{message}</li>)}
                </Box>
              </Alert>
            ) : null}
            {children}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ position: 'sticky', bottom: 0, bgcolor: 'background.paper', px: 3, py: 1.5, gap: 0.5 }}>
          <Button onClick={onCancel} disabled={loading}>Cancel</Button>
          {showApply ? <Button variant="outlined" onClick={onApply} disabled={loading || applyDisabled}>{applyLabel}</Button> : null}
          {onApplyAndRun ? (
            <Button variant="contained" onClick={onApplyAndRun} disabled={loading || runDisabled}>
              {loading ? <CircularProgress size={16} color="inherit" sx={{ mr: 1 }} /> : null}
              {applyAndRunLabel}
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>
      <Dialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        aria-labelledby="discard-scientific-setup-title"
        maxWidth="xs"
        fullWidth
        slotProps={{ transition: { onExited: restoreAfterDiscardTransition } }}
      >
        <DialogTitle id="discard-scientific-setup-title">Discard unapplied changes?</DialogTitle>
        <DialogContent>
          <DialogContentText>Your changes have not been applied. Discard them and close the setup dialog?</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDiscard(false)}>Keep Editing</Button>
          <Button color="error" variant="contained" onClick={discardChanges}>Discard Changes</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
