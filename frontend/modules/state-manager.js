import { deepClone } from './utils.js';
import { normalizeTemplateStageSize, normalizeTemplateModuleSettings } from './normalize.js';
import { BUILDER_DRAFT_STORAGE_KEY, DEFAULT_STAGE_SIZE } from './constants.js';

/**
 * State Manager Module
 * Handles History (Undo/Redo) and Persistence (Autosave/Drafts)
 */

export const createEditorSnapshot = (builder) => {
  return JSON.stringify({
    slides: deepClone(builder.state.slides || []),
    activeSlideId: builder.state.activeSlideId,
    selectedElementId: builder.selectedElementId,
    stageSize: deepClone(builder.state.stageSize),
    moduleSettings: deepClone(builder.state.moduleSettings),
    moduleTitle: builder.ui.moduleTitleInput?.value?.trim() || '',
    moduleDescription: builder.ui.moduleDescriptionInput?.value?.trim() || '',
    selectedCourseId: builder.ui.moduleCourseSelect?.value || '',
    editingModuleId: builder.editingModuleId,
    editingCourseId: builder.editingCourseId,
    editingModuleCourseId: builder.editingModuleCourseId
  });
};

export const applyEditorSnapshot = (builder, snapshot) => {
  try {
    const state = JSON.parse(snapshot);
    builder.history.suppressCommit = true;
    
    builder.state.slides = Array.isArray(state.slides) ? state.slides : [];
    builder.state.activeSlideId = state.activeSlideId || builder.state.slides[0]?.id || null;
    builder.state.stageSize = normalizeTemplateStageSize(state.stageSize);
    builder.state.moduleSettings = normalizeTemplateModuleSettings(state.moduleSettings);
    builder.selectedElementId = state.selectedElementId || null;
    
    // UI Sync
    if (builder.ui.moduleTitleInput) builder.ui.moduleTitleInput.value = state.moduleTitle || '';
    if (builder.ui.moduleDescriptionInput) builder.ui.moduleDescriptionInput.value = state.moduleDescription || '';
    if (builder.ui.moduleLockNextToggle) builder.ui.moduleLockNextToggle.checked = Boolean(builder.state.moduleSettings.lockNextModuleUntilCompleted);
    if (builder.ui.moduleRequireQuizToggle) builder.ui.moduleRequireQuizToggle.checked = Boolean(builder.state.moduleSettings.requireQuizCompletion);
    if (builder.ui.modulePublicToggle) builder.ui.modulePublicToggle.checked = Boolean(builder.state.moduleSettings.isPublic);
    
    if (builder.ui.moduleCourseSelect && state.selectedCourseId) {
      builder.ui.moduleCourseSelect.value = state.selectedCourseId;
    }
    
    builder.history.suppressCommit = false;
  } catch (error) {
    console.error('[STATE] Failed to apply snapshot:', error);
  }
};

export const commitHistoryState = (builder) => {
  if (builder.history.suppressCommit) return;
  
  const snapshot = createEditorSnapshot(builder);
  const lastSnapshot = builder.history.past[builder.history.past.length - 1];
  
  if (lastSnapshot === snapshot) {
    return;
  }
  
  builder.history.past.push(snapshot);
  builder.history.future = [];
  
  // Limit history size
  if (builder.history.past.length > 50) {
    builder.history.past.shift();
  }
};

export const undoLastAction = (builder) => {
  if (builder.history.past.length <= 1) return;
  
  const current = builder.history.past.pop();
  builder.history.future.push(current);
  
  const previous = builder.history.past[builder.history.past.length - 1];
  applyEditorSnapshot(builder, previous);
};

export const redoLastAction = (builder) => {
  if (builder.history.future.length === 0) return;
  
  const next = builder.history.future.pop();
  builder.history.past.push(next);
  
  applyEditorSnapshot(builder, next);
};

export const persistBuilderDraftLocally = (builder) => {
  if (builder.autosave.isRestoring) return;
  
  try {
    const payload = JSON.parse(createEditorSnapshot(builder));
    if (!payload.slides || payload.slides.length === 0) return;
    
    localStorage.setItem(BUILDER_DRAFT_STORAGE_KEY, JSON.stringify(payload));
    console.log('[AUTOSAVE] 💾 Local draft updated');
  } catch (error) {
    console.warn('[AUTOSAVE] ❌ Error saving local draft:', error);
  }
};

export const restoreBuilderDraftIfAvailable = (builder) => {
  if (builder.autosave.isRestoring) return false;
  
  builder.autosave.isRestoring = true;
  try {
    const rawDraft = localStorage.getItem(BUILDER_DRAFT_STORAGE_KEY);
    if (!rawDraft) {
      builder.autosave.isRestoring = false;
      return false;
    }
    
    applyEditorSnapshot(builder, rawDraft);
    builder.history.past = [rawDraft];
    builder.history.future = [];
    
    console.log('[AUTOSAVE] ✅ Local draft restored');
    builder.autosave.isRestoring = false;
    return true;
  } catch (error) {
    console.warn('[AUTOSAVE] ❌ Error restoring local draft:', error);
    builder.autosave.isRestoring = false;
    return false;
  }
};
