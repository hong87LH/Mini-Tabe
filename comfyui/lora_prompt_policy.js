function getLoraProfile(manifest, profileId) {
  const profiles = manifest?.loraProfiles || {};
  if (Array.isArray(profiles)) return profiles.find(profile => profile?.id === profileId) || null;
  return profiles[profileId] || null;
}

function applyPromptText(currentPrompt, policy, side) {
  const text = String(policy?.text || '').trim();
  if (!text) return currentPrompt;
  const current = String(currentPrompt || '').trim();
  const separator = typeof policy.separator === 'string' ? policy.separator : '\n';
  if (current === text || current.startsWith(`${text}${separator}`) || current.endsWith(`${separator}${text}`)) return current;
  if (!current) return text;
  return side === 'append' ? `${current}${separator}${text}` : `${text}${separator}${current}`;
}

export function composeLoraProfilePrompt(manifest, profileIds = [], userPrompt = '') {
  const entries = [...new Set((profileIds || []).map(value => String(value).trim()).filter(Boolean))]
    .map(profileId => ({ profileId, profile: getLoraProfile(manifest, profileId) }))
    .filter(entry => entry.profile);

  const unsupported = entries.find(entry => !['none', 'prepend', 'append'].includes(entry.profile.promptPolicy?.mode || 'none'));
  if (unsupported) {
    throw new Error(`LoRA Profile ${unsupported.profileId} 使用了不支持的 promptPolicy.mode：${unsupported.profile.promptPolicy.mode}`);
  }

  let result = String(userPrompt || '').trim();
  const prepends = entries.filter(entry => (entry.profile.promptPolicy?.mode || 'none') === 'prepend');
  const appends = entries.filter(entry => entry.profile.promptPolicy?.mode === 'append');

  for (const entry of [...prepends].reverse()) {
    result = applyPromptText(result, entry.profile.promptPolicy, 'prepend');
  }
  for (const entry of appends) {
    result = applyPromptText(result, entry.profile.promptPolicy, 'append');
  }
  return result;
}

export function composeWorkflowPromptWithTemplate(promptPolicy, templatePrompt, userPrompt = '') {
  const user = String(userPrompt || '').trim();
  if (promptPolicy?.mode !== 'append') return user;
  const base = String(templatePrompt || '').trim();
  if (!base) return user;
  if (!user || user === base || user.startsWith(base)) return user || base;
  const separator = typeof promptPolicy.separator === 'string' ? promptPolicy.separator : '\n';
  return `${base}${separator}${user}`;
}

export function composeRegisteredWorkflowPrompt(workflow, requestedMode, userPrompt = '') {
  const defaults = Array.isArray(workflow.promptDefaults) ? workflow.promptDefaults : [];
  const normalizedMode = String(requestedMode || workflow.defaultMode || '').trim().toLowerCase();
  const selected = defaults.find(entry => (entry.modes || []).some(mode => String(mode).toLowerCase() === normalizedMode))
    || defaults.find(entry => (entry.modes || []).some(mode => String(mode).toLowerCase() === String(workflow.defaultMode || '').toLowerCase()))
    || defaults[0];
  return composeWorkflowPromptWithTemplate(workflow?.promptPolicy, selected?.text, userPrompt);
}
