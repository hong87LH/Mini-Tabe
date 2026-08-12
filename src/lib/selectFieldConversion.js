export const SELECT_TEXT_SEPARATOR = /[,，;；\r\n]+/;

export function selectValueToText(value, options) {
  const optionNames = new Map(options.map(option => [option.id, option.name]));
  if (Array.isArray(value)) {
    return value
      .map(id => optionNames.get(String(id)))
      .filter(Boolean)
      .join(', ');
  }
  if (value == null || value === '') return '';
  return optionNames.get(String(value)) || '';
}

export function parseSelectText(value, multiple) {
  if (typeof value !== 'string') return [];
  const parts = multiple ? value.split(SELECT_TEXT_SEPARATOR) : [value];
  const seen = new Set();
  return parts
    .map(part => part.trim())
    .filter(part => {
      if (!part || seen.has(part)) return false;
      seen.add(part);
      return true;
    });
}
