import { deepClone } from './utils.js';
import { 
  normalizeQuizElement, 
  normalizeFloatingActionConfig, 
  normalizeVideoTriggerConfig, 
  normalizeElementAnimation, 
  normalizeInputElement
} from './normalize.js';
import { normalizeBlockTexture } from './ui-renderer.js';
import { ANIMATABLE_ELEMENT_TYPES, createId } from './constants.js';

/**
 * AI Assistant Logic Module
 */

export const getFallbackAiSlideTargetFromState = (targetState, requestedSlideId) => {
  const existingSlides = targetState?.slides || [];
  if (!existingSlides.length) return null;
  const directMatch = existingSlides.find((entry) => entry.id === requestedSlideId);
  if (directMatch) return directMatch;
  if (existingSlides.length === 1) return existingSlides[0];
  const activeSlide = existingSlides.find((entry) => entry.id === targetState?.activeSlideId);
  return activeSlide || existingSlides[0];
};

export const inferElementTypeFromAiId = (elementId = '') => {
  const value = String(elementId || '').toLowerCase();
  if (value.includes('bloco') || value.includes('block')) return 'block';
  if (value.includes('texto') || value.includes('text')) return 'text';
  if (value.includes('title') || value.includes('titulo') || value.includes('subtitle') || value.includes('subtitulo')) return 'text';
  if (value.includes('botao') || value.includes('botão') || value.includes('button')) return 'floatingButton';
  if (value.includes('quiz')) return 'quiz';
  if (value.includes('imagem') || value.includes('image')) return 'image';
  if (value.includes('video')) return 'video';
  if (value.includes('audio')) return 'audio';
  return '';
};

export const inferElementTypeFromAiPatch = (patch = {}, fallbackId = '') => {
  if (patch?.type) return patch.type;
  const inferredFromId = inferElementTypeFromAiId(patch?.id || fallbackId);
  if (inferredFromId) return inferredFromId;
  if (Array.isArray(patch?.options) || typeof patch?.question === 'string') return 'quiz';
  if (typeof patch?.src === 'string' && patch.src) {
    if (typeof patch?.provider === 'string' || typeof patch?.embedSrc === 'string') return 'video';
    return 'image';
  }
  if (typeof patch?.label === 'string' && patch.label) return 'floatingButton';
  if (typeof patch?.content === 'string' && patch.content) return 'text';
  return '';
};

export const getFallbackAiElementTarget = (slide, action) => {
  if (!slide?.elements?.length) return null;
  const exact = slide.elements.find((entry) => entry.id === action.elementId);
  if (exact) return exact;
  const inferredType = action.element?.type || inferElementTypeFromAiId(action.elementId);
  const sameType = inferredType ? slide.elements.filter((entry) => entry.type === inferredType) : [];
  if (sameType.length === 1) return sameType[0];
  if (slide.elements.length === 1) return slide.elements[0];
  return null;
};

export const doesSlideHaveRenderableContent = (slide) =>
  Boolean(slide?.elements?.length) ||
  Boolean(slide?.backgroundImage) ||
  Boolean(slide?.backgroundVideo) ||
  Boolean(slide?.requireQuizCompletion) ||
  slide?.backgroundFillType === 'gradient' ||
  (slide?.backgroundColor && String(slide.backgroundColor).trim().toLowerCase() !== '#fdfbff');

export const isSingleSimpleAiInsertion = (actions) =>
  Array.isArray(actions) &&
  actions.length === 1 &&
  actions[0]?.type === 'add_element' &&
  Boolean(actions[0]?.element?.type);

export const AI_STAGE_MUTATION_ACTIONS = new Set(['add_element', 'update_element', 'delete_element', 'update_slide', 'select_element']);

export const doesAiActionTouchCurrentStage = (action, activeSlideId) => {
  if (!action || !AI_STAGE_MUTATION_ACTIONS.has(action.type)) return false;
  if (!activeSlideId) return true;
  return !action.slideId || action.slideId === activeSlideId;
};

export const shouldForceNewSlideForAiActions = (targetState, actions) => {
  const activeSlide = getFallbackAiSlideTargetFromState(targetState, targetState?.activeSlideId);
  if (!activeSlide || !doesSlideHaveRenderableContent(activeSlide) || isSingleSimpleAiInsertion(actions)) {
    return false;
  }
  return Array.isArray(actions) && actions.some((action) => doesAiActionTouchCurrentStage(action, activeSlide.id));
};

export const prepareAiActionsForSlidePlacement = (targetState, actions, strategy = 'auto') => {
  if (!Array.isArray(actions) || !actions.length) return [];
  const normalizedActions = actions.map((action) => deepClone(action));
  const activeSlide = getFallbackAiSlideTargetFromState(targetState, targetState?.activeSlideId);
  
  if (!shouldForceNewSlideForAiActions(targetState, normalizedActions)) {
    return normalizedActions;
  }
  
  if (strategy !== 'new' && strategy !== 'auto') {
    return normalizedActions;
  }
  
  const redirectedSlideId = createId('slide');
  const redirectedSlideTitle = `Slide ${((targetState?.slides || []).length || 0) + 1}`;
  const redirectedActions = normalizedActions.map((action) => {
    const nextAction = deepClone(action);
    const targetsCurrentSlide = !nextAction.slideId || nextAction.slideId === activeSlide.id;
    if (targetsCurrentSlide && ['add_element', 'update_element', 'delete_element', 'select_element', 'update_slide'].includes(nextAction.type)) {
      nextAction.slideId = redirectedSlideId;
    }
    if (nextAction.afterSlideId === activeSlide.id) {
      nextAction.afterSlideId = redirectedSlideId;
    }
    return nextAction;
  });
  
  redirectedActions.unshift({
    type: 'add_slide',
    slide: {
      id: redirectedSlideId,
      title: redirectedSlideTitle
    },
    afterSlideId: activeSlide.id,
    setActive: true,
    reason: 'Criar novo slide antes de aplicar uma composição completa em um palco já ocupado.'
  });
  
  return redirectedActions;
};

export const updateElementFromPatch = (element, patch, context = {}) => {
  Object.assign(element, patch);
  
  if (['block', 'floatingButton'].includes(element.type)) {
    if (patch.backgroundColor && !patch.solidColor && !patch.useGradient) {
      element.solidColor = patch.backgroundColor;
    }
    if (patch.solidColor && !patch.backgroundColor && !patch.useGradient) {
      element.backgroundColor = patch.solidColor;
    }
    if (patch.useGradient && patch.gradientStart && !patch.gradientEnd) {
      element.gradientEnd = patch.gradientStart;
    }
    if (patch.useGradient && patch.gradientEnd && !patch.gradientStart) {
      element.gradientStart = patch.gradientEnd;
    }
  }
  
  if (element.type === 'quiz') normalizeQuizElement(element);
  if (element.type === 'floatingButton') normalizeFloatingActionConfig(element);
  if (element.type === 'video') normalizeVideoTriggerConfig(element);
  if (ANIMATABLE_ELEMENT_TYPES.has(element.type)) normalizeElementAnimation(element);
  if (element.type === 'block') normalizeBlockTexture(element);
  if (element.type === 'input') {
    normalizeInputElement(element);
    normalizeFloatingActionConfig(element);
  }
  
  if (element.type === 'text') {
    element.hasTextBlock = Boolean(element.hasTextBackground || element.hasTextBorder || element.hasTextBlock);
  }
  
  if (context.syncElementBackgroundState) context.syncElementBackgroundState(element);
  if (context.ensureElementHasUsableSize) context.ensureElementHasUsableSize(element);
  if (context.applyStageConstraints) context.applyStageConstraints(element);
};

export const applyAiActionsToState = (targetState, actions, options = {}) => {
  if (!Array.isArray(actions) || !actions.length) {
    return { appliedCount: 0, warnings: [], selectedElementId: options.selectedElementId || null };
  }
  
  const normalizedActions = options.skipPlacement ? actions : prepareAiActionsForSlidePlacement(targetState, actions, options.slidePlacement || 'auto');
  
  let nextSelectedElementId = options.selectedElementId || null;
  let nextActiveSlideId = targetState?.activeSlideId || null;
  const applyWarnings = [];
  let appliedCount = 0;
  
  const slideAliasMap = new Map();
  const elementAliasMap = new Map();
  const resolveSlideAlias = (slideId = '') => slideAliasMap.get(slideId) || slideId;
  const resolveElementAlias = (elementId = '') => elementAliasMap.get(elementId) || elementId;

  normalizedActions.forEach((rawAction, index) => {
    const action = deepClone(rawAction);
    
    // Resolve aliases
    if (action.slideId) action.slideId = resolveSlideAlias(action.slideId);
    if (action.afterSlideId) action.afterSlideId = resolveSlideAlias(action.afterSlideId);
    if (action.elementId) action.elementId = resolveElementAlias(action.elementId);
    
    // Nested targets
    if (action.element?.actionConfig?.targetSlideId) {
      action.element.actionConfig.targetSlideId = resolveSlideAlias(action.element.actionConfig.targetSlideId);
    }
    if (action.element?.actionConfig?.targetElementId) {
      action.element.actionConfig.targetElementId = resolveElementAlias(action.element.actionConfig.targetElementId);
    }
    
    // Triggers
    if (Array.isArray(action.element?.interactionTriggers)) {
      action.element.interactionTriggers.forEach((trigger) => {
        if (trigger?.actionConfig?.targetSlideId) {
          trigger.actionConfig.targetSlideId = resolveSlideAlias(trigger.actionConfig.targetSlideId);
        }
        if (trigger?.actionConfig?.targetElementId) {
          trigger.actionConfig.targetElementId = resolveElementAlias(trigger.actionConfig.targetElementId);
        }
      });
    }

    switch (action.type) {
      case 'add_slide': {
        const originalSlideId = action.slide?.id || '';
        let nextSlideId = originalSlideId || createId('slide');
        while ((targetState?.slides || []).some((entry) => entry?.id === nextSlideId)) {
          nextSlideId = createId('slide');
        }
        const slide = {
          id: nextSlideId,
          title: action.slide?.title || `Slide ${(targetState?.slides?.length || 0) + 1}`,
          elements: [],
          backgroundImage: action.slide?.backgroundImage || null,
          backgroundColor: action.slide?.backgroundColor || '#fdfbff'
        };
        
        // Insert slide logic
        const targetSlides = targetState.slides;
        const afterSlideId = action.afterSlideId;
        if (!afterSlideId) {
          targetSlides.push(slide);
        } else {
          const targetIndex = targetSlides.findIndex((entry) => entry.id === afterSlideId);
          if (targetIndex === -1) targetSlides.push(slide);
          else targetSlides.splice(targetIndex + 1, 0, slide);
        }

        if (originalSlideId) slideAliasMap.set(originalSlideId, slide.id);
        if (action.setActive !== false) nextActiveSlideId = slide.id;
        appliedCount += 1;
        break;
      }
      
      case 'update_slide': {
        let slide = getFallbackAiSlideTargetFromState(targetState, action.slideId);
        if (!slide || !action.slide) {
          applyWarnings.push(`Ação ${index + 1}: slide não encontrado para update_slide.`);
          break;
        }
        const slidePatch = { ...action.slide };
        delete slidePatch.id;
        Object.assign(slide, slidePatch);
        if (action.setActive !== false) nextActiveSlideId = slide.id;
        appliedCount += 1;
        break;
      }
      
      case 'delete_slide': {
        if (targetState.slides.length <= 1) break;
        const index = targetState.slides.findIndex((entry) => entry.id === action.slideId);
        if (index === -1) break;
        targetState.slides.splice(index, 1);
        if (nextActiveSlideId === action.slideId) {
          nextActiveSlideId = targetState.slides[index]?.id || targetState.slides[index - 1]?.id || targetState.slides[0]?.id || null;
        }
        appliedCount += 1;
        break;
      }
      
      case 'add_element': {
        const originalElementId = action.element?.id || action.elementId || '';
        const inferredType = inferElementTypeFromAiPatch(action.element, originalElementId);
        if (action.element && !action.element.type && inferredType) {
          action.element.type = inferredType;
        }
        if (!action.element?.type) {
          applyWarnings.push(`Ação ${index + 1}: add_element sem tipo de elemento.`);
          break;
        }
        const targetSlide = getFallbackAiSlideTargetFromState(targetState, action.slideId);
        if (!targetSlide) {
          applyWarnings.push(`Ação ${index + 1}: slide alvo não encontrado.`);
          break;
        }
        
        // Add element logic
        let nextElementId = action.element.id || createId('element');
        while (targetSlide.elements?.some((entry) => entry?.id === nextElementId)) {
          nextElementId = createId('element');
        }
        
        const element = {
          id: nextElementId,
          type: action.element.type,
          x: action.element.x || 50,
          y: action.element.y || 60,
          zIndex: (targetSlide.elements.length > 0 ? Math.max(...targetSlide.elements.map(e => e.zIndex || 0)) : 0) + 1,
          ...action.element
        };
        
        // Standard normalizations
        if (element.type === 'quiz') normalizeQuizElement(element);
        if (element.type === 'floatingButton') normalizeFloatingActionConfig(element);
        if (element.type === 'video') normalizeVideoTriggerConfig(element);
        if (ANIMATABLE_ELEMENT_TYPES.has(element.type)) normalizeElementAnimation(element);
        if (element.type === 'block') normalizeBlockTexture(element);
        if (element.type === 'input') {
          normalizeInputElement(element);
          normalizeFloatingActionConfig(element);
        }

        targetSlide.elements.push(element);
        if (originalElementId) elementAliasMap.set(originalElementId, element.id);
        if (action.setActive !== false) {
          nextActiveSlideId = targetSlide.id;
          nextSelectedElementId = element.id;
        }
        appliedCount += 1;
        break;
      }
      
      case 'update_element': {
        const slide = getFallbackAiSlideTargetFromState(targetState, action.slideId);
        const element = getFallbackAiElementTarget(slide, action);
        if (!element || !action.element) {
          applyWarnings.push(`Ação ${index + 1}: elemento não encontrado.`);
          break;
        }
        updateElementFromPatch(element, action.element, options.context || {});
        if (action.setActive !== false) {
          nextActiveSlideId = slide.id;
          nextSelectedElementId = element.id;
        }
        appliedCount += 1;
        break;
      }
      
      case 'delete_element': {
        const slide = getFallbackAiSlideTargetFromState(targetState, action.slideId);
        const targetElement = getFallbackAiElementTarget(slide, action);
        if (!targetElement) break;
        slide.elements = slide.elements.filter((entry) => entry.id !== targetElement.id);
        if (nextSelectedElementId === targetElement.id) nextSelectedElementId = null;
        appliedCount += 1;
        break;
      }
      
      case 'select_element': {
        nextActiveSlideId = action.slideId || nextActiveSlideId;
        nextSelectedElementId = action.elementId || null;
        appliedCount += 1;
        break;
      }
    }
  });

  targetState.activeSlideId = nextActiveSlideId;
  return { appliedCount, warnings: applyWarnings, selectedElementId: nextSelectedElementId };
};
