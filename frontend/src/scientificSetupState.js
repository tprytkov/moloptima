export function configurationsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createScientificSetupState(appliedConfiguration) {
  return {
    open: false,
    appliedConfiguration,
    draftConfiguration: { ...appliedConfiguration },
    dirty: false,
    validationErrors: [],
  };
}

export function scientificSetupReducer(state, action) {
  switch (action.type) {
    case 'open':
      return {
        ...state,
        open: true,
        draftConfiguration: { ...state.appliedConfiguration },
        dirty: false,
        validationErrors: [],
      };
    case 'change': {
      const draftConfiguration = { ...state.draftConfiguration, ...action.patch };
      return {
        ...state,
        draftConfiguration,
        dirty: !configurationsEqual(draftConfiguration, state.appliedConfiguration),
        validationErrors: [],
      };
    }
    case 'validation-failed':
      return { ...state, validationErrors: action.errors || [] };
    case 'apply':
      return {
        ...state,
        open: false,
        appliedConfiguration: { ...state.draftConfiguration },
        dirty: false,
        validationErrors: [],
      };
    case 'apply-and-run':
      return {
        ...state,
        appliedConfiguration: { ...state.draftConfiguration },
        dirty: false,
        validationErrors: [],
      };
    case 'run-finished':
      return { ...state, open: false };
    case 'cancel':
      return {
        ...state,
        open: false,
        draftConfiguration: { ...state.appliedConfiguration },
        dirty: false,
        validationErrors: [],
      };
    default:
      return state;
  }
}
