import { storage } from './storage';
import type { MessageTemplate, TriggerRule } from '@shared/schema';

interface MessageContext {
  messageType?: string;
  message?: string;
  variables?: Record<string, string>;
  [key: string]: unknown;
}

interface SelectionResult {
  template: MessageTemplate | null;
  matchedBy: 'messageType' | 'triggerRule' | 'default' | 'none';
  matchDetails?: string;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((current, key) => {
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj as unknown);
}

function evaluateTriggerRule(rule: TriggerRule, context: MessageContext): boolean {
  const fieldValue = getNestedValue(context as Record<string, unknown>, rule.field);
  
  if (rule.operator === 'exists') {
    return fieldValue !== undefined && fieldValue !== null && fieldValue !== '';
  }
  
  if (fieldValue === undefined || fieldValue === null) {
    return false;
  }
  
  const stringValue = String(fieldValue);
  const ruleValue = rule.value || '';
  
  switch (rule.operator) {
    case 'equals':
      return stringValue.toLowerCase() === ruleValue.toLowerCase();
    case 'contains':
      return stringValue.toLowerCase().includes(ruleValue.toLowerCase());
    case 'startsWith':
      return stringValue.toLowerCase().startsWith(ruleValue.toLowerCase());
    case 'endsWith':
      return stringValue.toLowerCase().endsWith(ruleValue.toLowerCase());
    case 'regex':
      try {
        const regex = new RegExp(ruleValue, 'i');
        return regex.test(stringValue);
      } catch {
        console.warn(`[Template Selector] Invalid regex: ${ruleValue}`);
        return false;
      }
    default:
      return false;
  }
}

function evaluateTriggerRules(rules: TriggerRule[], context: MessageContext): boolean {
  if (!rules || rules.length === 0) return false;
  return rules.every(rule => evaluateTriggerRule(rule, context));
}

export async function selectTemplate(context: MessageContext): Promise<SelectionResult> {
  const templates = await storage.getAllMessageTemplates();
  
  const activeTemplates = templates
    .filter(t => t.isActive !== false)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  
  if (activeTemplates.length === 0) {
    console.log('[Template Selector] No active templates found');
    return { template: null, matchedBy: 'none' };
  }
  
  if (context.messageType) {
    const typeMatch = activeTemplates.find(
      t => t.messageType?.toLowerCase() === context.messageType?.toLowerCase()
    );
    if (typeMatch) {
      console.log(`[Template Selector] Matched by messageType: ${typeMatch.name}`);
      return {
        template: typeMatch,
        matchedBy: 'messageType',
        matchDetails: `Matched message type: ${context.messageType}`
      };
    }
  }
  
  for (const template of activeTemplates) {
    const rules = template.triggerRules as TriggerRule[] | null;
    if (rules && rules.length > 0) {
      if (evaluateTriggerRules(rules, context)) {
        console.log(`[Template Selector] Matched by trigger rules: ${template.name}`);
        return {
          template,
          matchedBy: 'triggerRule',
          matchDetails: `Matched ${rules.length} trigger rule(s)`
        };
      }
    }
  }
  
  const defaultTemplate = activeTemplates.find(t => t.isDefault === true);
  if (defaultTemplate) {
    console.log(`[Template Selector] Using default template: ${defaultTemplate.name}`);
    return {
      template: defaultTemplate,
      matchedBy: 'default',
      matchDetails: 'No specific match, using default template'
    };
  }
  
  console.log('[Template Selector] No matching template found');
  return { template: null, matchedBy: 'none' };
}

export function renderTemplate(template: MessageTemplate, variables: Record<string, string>): string {
  let content = template.content;
  
  for (let i = 1; i <= 10; i++) {
    const placeholder = `{{${i}}}`;
    const varName = template.variables?.[i - 1];
    if (varName && variables[varName] !== undefined) {
      content = content.split(placeholder).join(variables[varName]);
    }
  }
  
  for (const [key, value] of Object.entries(variables)) {
    content = content.split(`{{${key}}}`).join(value);
  }
  
  return content;
}
